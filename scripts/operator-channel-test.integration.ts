import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  confirmOperatorTestResult,
  createDatabase,
  OperatorChannelTestError,
  prepareOperatorWhatsAppTest,
  recordOperatorTestOpen,
  recordOperatorTestResponse,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const raw = postgres(databaseUrl, { max: 4 });
const { db, close } = createDatabase(databaseUrl, { max: 6 });
const auth = createAuthorizationContext({
  principalId: 'operator-test-integration',
  permissions: new Set([
    'operator-test:prepare',
    'operator-test:open',
    'operator-test:confirm',
    'operator-test:response',
  ]),
  authenticationMethod: 'integration-test',
});
const runtime = {
  enabled: true,
  killSwitchEnabled: false,
  authorizedPhoneE164: '+5511999999999',
  fingerprintKey: 'operator-test-integration-hmac-key-0001',
} as const;
const input = (idempotencyKey = randomUUID()) => ({
  templateId: 'operator-whatsapp-channel-test',
  templateVersion: 'v1',
  idempotencyKey,
});
const expectCode = async (
  action: Promise<unknown>,
  code: OperatorChannelTestError['code'],
) => {
  await assert.rejects(
    action,
    (error: unknown) => error instanceof OperatorChannelTestError && error.code === code,
  );
};

const passed: string[] = [];
const pass = (name: string) => passed.push(name);

try {
  await raw`truncate operator_channel_test_events,operator_channel_test_preparations restart identity cascade`;

  const preparationKey = randomUUID();
  const first = await prepareOperatorWhatsAppTest(db, input(preparationKey), auth, runtime);
  assert.equal(first.state, 'PREPARED');
  assert.equal(first.replayed, false);
  assert.match(first.link, /^https:\/\/wa\.me\/5511999999999\?text=/);
  assert.match(first.recipientFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(first.recipientFingerprint.includes('5511999999999'), false);
  pass('01 preparation created');

  const persisted = (
    await raw<{
      recipient_fingerprint: string;
      result_snapshot: Record<string, unknown>;
      snapshot_text: string;
    }[]>`select recipient_fingerprint,result_snapshot,result_snapshot::text snapshot_text
         from operator_channel_test_preparations where id=${first.preparationId}::uuid`
  )[0]!;
  assert.equal(persisted.recipient_fingerprint, first.recipientFingerprint);
  assert.equal(persisted.snapshot_text.includes('5511999999999'), false);
  assert.deepEqual(
    Object.keys(persisted.result_snapshot).sort(),
    [
      'channel',
      'messageFingerprint',
      'purpose',
      'recipientFingerprint',
      'templateId',
      'templateVersion',
    ].sort(),
  );
  pass('02 persistence contains fingerprints only');

  const replay = await prepareOperatorWhatsAppTest(db, input(preparationKey), auth, runtime);
  assert.equal(replay.preparationId, first.preparationId);
  assert.equal(replay.replayed, true);
  pass('03 preparation replay is idempotent');

  await expectCode(
    prepareOperatorWhatsAppTest(
      db,
      input(preparationKey),
      auth,
      { ...runtime, authorizedPhoneE164: '+5511888888888' },
    ),
    'IDEMPOTENCY_CONFLICT',
  );
  pass('04 changed recipient conflicts with prior key');

  const concurrentKey = randomUUID();
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      prepareOperatorWhatsAppTest(db, input(concurrentKey), auth, runtime)),
  );
  assert.equal(new Set(concurrent.map((item) => item.preparationId)).size, 1);
  assert.equal(concurrent.filter((item) => !item.replayed).length, 1);
  pass('05 concurrent preparation collapses to one record');

  const orderProbe = await prepareOperatorWhatsAppTest(db, input(), auth, runtime);
  await expectCode(
    confirmOperatorTestResult(
      db,
      orderProbe.preparationId,
      { result: 'SENT_CONFIRMED', idempotencyKey: randomUUID() },
      auth,
      runtime,
    ),
    'INVALID_STATE',
  );
  await assert.rejects(
    raw`insert into operator_channel_test_events(
          preparation_id,event_type,result,operator_principal_id,payload_fingerprint,idempotency_key
        ) values(
          ${orderProbe.preparationId}::uuid,'CONTACT_CONFIRMED','SENT_CONFIRMED',
          ${auth.principalId},${'a'.repeat(64)},${randomUUID()}
        )`,
  );
  pass('06 service and PostgreSQL reject out-of-order confirmation');

  const opened = await recordOperatorTestOpen(
    db,
    first.preparationId,
    { idempotencyKey: 'open-primary' },
    auth,
    runtime,
  );
  assert.equal(opened.state, 'OPENED');
  assert.equal(opened.replayed, false);
  const openedReplay = await recordOperatorTestOpen(
    db,
    first.preparationId,
    { idempotencyKey: 'open-primary' },
    auth,
    runtime,
  );
  assert.equal(openedReplay.eventId, opened.eventId);
  assert.equal(openedReplay.replayed, true);
  pass('07 OPENED is idempotent');

  const confirmed = await confirmOperatorTestResult(
    db,
    first.preparationId,
    { result: 'SENT_CONFIRMED', idempotencyKey: 'confirm-primary' },
    auth,
    runtime,
  );
  assert.equal(confirmed.result, 'SENT_CONFIRMED');
  await expectCode(
    confirmOperatorTestResult(
      db,
      first.preparationId,
      { result: 'NOT_SENT', idempotencyKey: 'confirm-contradictory' },
      auth,
      runtime,
    ),
    'INVALID_STATE',
  );
  pass('08 contradictory confirmation is rejected');

  const response = await recordOperatorTestResponse(
    db,
    first.preparationId,
    { result: 'RECEIVED_CONFIRMED', idempotencyKey: 'response-primary' },
    auth,
    runtime,
  );
  assert.equal(response.result, 'RECEIVED_CONFIRMED');
  pass('09 response is accepted only after SENT_CONFIRMED');

  const notSent = await prepareOperatorWhatsAppTest(db, input(), auth, runtime);
  await recordOperatorTestOpen(db, notSent.preparationId, { idempotencyKey: 'open-not-sent' }, auth, runtime);
  await confirmOperatorTestResult(
    db,
    notSent.preparationId,
    { result: 'NOT_SENT', idempotencyKey: 'confirm-not-sent' },
    auth,
    runtime,
  );
  await expectCode(
    recordOperatorTestResponse(
      db,
      notSent.preparationId,
      { result: 'NOT_RECEIVED', idempotencyKey: 'response-not-sent' },
      auth,
      runtime,
    ),
    'INVALID_STATE',
  );
  pass('10 NOT_SENT cannot produce a response event');

  await assert.rejects(
    raw`update operator_channel_test_preparations set template_version='v2'
        where id=${first.preparationId}::uuid`,
  );
  await assert.rejects(
    raw`delete from operator_channel_test_events where preparation_id=${first.preparationId}::uuid`,
  );
  pass('11 preparation and event history are append-only');

  const columns = await raw<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema='public'
      and table_name in ('operator_channel_test_preparations','operator_channel_test_events')
  `;
  assert.equal(
    columns.some(({ column_name }) => /phone|telephone|whatsapp|recipient_value|contact_value/i.test(column_name)),
    false,
  );
  pass('12 schema has no raw destination column');

  console.log(JSON.stringify({
    result: 'OPERATOR_CHANNEL_TEST_INTEGRATION_PASS',
    checks: passed,
  }, null, 2));
} finally {
  await close();
  await raw.end();
}
