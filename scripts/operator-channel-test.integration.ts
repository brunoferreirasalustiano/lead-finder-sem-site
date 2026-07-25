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
const serviceRole = postgres(databaseUrl, { max: 1 });
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
let createdServiceRole = false;
let serviceRoleGrantedTo: string | undefined;

async function provisionServiceRole(): Promise<void> {
  const exists = await raw<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname = 'service_role') as exists`;
  if (!exists[0]?.exists) {
    await raw.unsafe('CREATE ROLE service_role NOLOGIN');
    createdServiceRole = true;
  }
  const currentRole = (await raw<{ name: string }[]>`select current_user as name`)[0]!.name;
  await raw.unsafe(`GRANT service_role TO ${quoteIdentifier(currentRole)}`);
  serviceRoleGrantedTo = currentRole;
}

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

try {
  await provisionServiceRole();
  await raw`truncate operator_channel_test_events,operator_channel_test_preparations restart identity cascade`;

  const unauthorized = createAuthorizationContext({
    principalId: 'operator-test-without-permission',
    permissions: new Set(),
    authenticationMethod: 'integration-test',
  });
  await expectCode(
    prepareOperatorWhatsAppTest(db, input(), unauthorized, runtime),
    'FORBIDDEN',
  );
  const forged = {
    principalId: 'forged-operator-test',
    permissions: new Set(['operator-test:prepare']),
    authenticationMethod: 'forged',
  } as Parameters<typeof prepareOperatorWhatsAppTest>[2];
  await expectCode(
    prepareOperatorWhatsAppTest(db, input(), forged, runtime),
    'FORBIDDEN',
  );
  pass('00 untrusted or unauthorized contexts are rejected');

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
      message_fingerprint: string;
      result_fingerprint: string;
    }[]>`select recipient_fingerprint,message_fingerprint,result_fingerprint
         from operator_channel_test_preparations where id=${first.preparationId}::uuid`
  )[0]!;
  assert.equal(persisted.recipient_fingerprint, first.recipientFingerprint);
  assert.match(persisted.message_fingerprint, /^[0-9a-f]{64}$/);
  assert.match(persisted.result_fingerprint, /^[0-9a-f]{64}$/);
  pass('02 persistence contains scalar fingerprints only');

  await assert.rejects(
    raw`insert into operator_channel_test_events(
          preparation_id,event_type,result,operator_principal_id,payload_fingerprint,idempotency_key
        ) values(
          ${first.preparationId}::uuid,'OPENED',null,'different-operator',${'a'.repeat(64)},${randomUUID()}
        )`,
  );
  pass('03 PostgreSQL rejects a divergent event principal');

  await serviceRole.unsafe('SET ROLE service_role');
  await assert.rejects(
    serviceRole`insert into operator_channel_test_preparations(
      channel,purpose,recipient_fingerprint,template_id,template_version,operator_principal_id,
      payload_fingerprint,idempotency_key,message_fingerprint,result_fingerprint
    ) values(
      'WHATSAPP','OPERATOR_TEST',${'a'.repeat(64)},'operator-whatsapp-channel-test','v1',
      'service-role-direct',${'b'.repeat(64)},${randomUUID()},${'c'.repeat(64)},${'d'.repeat(64)}
    )`,
  );
  pass('04 service_role direct INSERT is rejected');

  const replay = await prepareOperatorWhatsAppTest(db, input(preparationKey), auth, runtime);
  assert.equal(replay.preparationId, first.preparationId);
  assert.equal(replay.replayed, true);
  pass('05 preparation replay is idempotent');

  await expectCode(
    prepareOperatorWhatsAppTest(
      db,
      input(preparationKey),
      auth,
      { ...runtime, authorizedPhoneE164: '+5511888888888' },
    ),
    'IDEMPOTENCY_CONFLICT',
  );
  pass('06 changed recipient conflicts with prior key');

  const concurrentKey = randomUUID();
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      prepareOperatorWhatsAppTest(db, input(concurrentKey), auth, runtime)),
  );
  assert.equal(new Set(concurrent.map((item) => item.preparationId)).size, 1);
  assert.equal(concurrent.filter((item) => !item.replayed).length, 1);
  pass('07 concurrent preparation collapses to one record');

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
  pass('08 service and PostgreSQL reject out-of-order confirmation');

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
  pass('09 OPENED is idempotent');

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
  pass('10 contradictory confirmation is rejected');

  const response = await recordOperatorTestResponse(
    db,
    first.preparationId,
    { result: 'RECEIVED_CONFIRMED', idempotencyKey: 'response-primary' },
    auth,
    runtime,
  );
  assert.equal(response.result, 'RECEIVED_CONFIRMED');
  pass('11 response is accepted only after SENT_CONFIRMED');

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
  pass('12 NOT_SENT cannot produce a response event');

  await assert.rejects(
    raw`update operator_channel_test_preparations set template_version='v2'
        where id=${first.preparationId}::uuid`,
  );
  await assert.rejects(
    raw`delete from operator_channel_test_events where preparation_id=${first.preparationId}::uuid`,
  );
  pass('13 preparation and event history are append-only');

  const columns = await raw<{ column_name: string; data_type: string }[]>`
    select column_name,data_type from information_schema.columns
    where table_schema='public'
    and table_name in ('operator_channel_test_preparations','operator_channel_test_events')
  `;
  assert.equal(
    columns.some(({ column_name }) => /phone|telephone|whatsapp|recipient_value|contact_value/i.test(column_name)),
    false,
  );
  assert.equal(
    columns.some(({ column_name }) => /message|body|url|link|snapshot|json|blob/i.test(column_name)
      && column_name !== 'message_fingerprint'),
    false,
  );
  assert.equal(columns.some(({ data_type }) => data_type === 'jsonb'), false);
  pass('14 schema has no raw destination, message, URL, or JSON column');

  console.log(JSON.stringify({
    result: 'OPERATOR_CHANNEL_TEST_INTEGRATION_PASS',
    checks: passed,
  }, null, 2));
} finally {
  await serviceRole.end();
  if (createdServiceRole && serviceRoleGrantedTo) {
    await raw.unsafe(`REVOKE service_role FROM ${quoteIdentifier(serviceRoleGrantedTo)}`).catch(() => undefined);
  }
  if (createdServiceRole) await raw.unsafe('DROP ROLE service_role').catch(() => undefined);
  await close();
  await raw.end();
}
