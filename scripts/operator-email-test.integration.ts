import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  createDatabase,
  OperatorEmailTestError,
  sendOperatorEmailTest,
  type OperatorEmailDelivery,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const raw = postgres(databaseUrl, { max: 4 });
const serviceRole = postgres(databaseUrl, { max: 1 });
const { db, close } = createDatabase(databaseUrl, { max: 6 });
const auth = createAuthorizationContext({
  principalId: 'operator-email-integration',
  permissions: new Set(['operator-email-test:send']),
  authenticationMethod: 'integration-test',
});
const runtime = {
  enabled: true,
  killSwitchEnabled: false,
  authorizedRecipient: 'operator@example.test',
  authorizedSender: 'operator@example.test',
  fingerprintKey: 'operator-email-integration-fingerprint-key-0001',
} as const;
const input = (idempotencyKey = randomUUID()) => ({
  templateId: 'operator-email-channel-test',
  templateVersion: 'v1',
  idempotencyKey,
});
const receipt = {
  provider: 'GMAIL_API',
  messageId: 'synthetic-gmail-message-id',
  response: 'HTTP 200',
} as const;
const expectCode = async (
  action: Promise<unknown>,
  code: OperatorEmailTestError['code'],
) => assert.rejects(
  action,
  (error: unknown) => error instanceof OperatorEmailTestError && error.code === code,
);
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

let createdServiceRole = false;
let serviceRoleGrantedTo: string | undefined;
async function provisionServiceRole() {
  const exists = await raw<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname='service_role') as exists`;
  if (!exists[0]?.exists) {
    await raw.unsafe('CREATE ROLE service_role NOLOGIN');
    createdServiceRole = true;
  }
  const currentRole = (await raw<{ name: string }[]>`
    select current_user as name`)[0]!.name;
  await raw.unsafe(`GRANT service_role TO ${quoteIdentifier(currentRole)}`);
  serviceRoleGrantedTo = currentRole;
}

try {
  await provisionServiceRole();
  const baselineSideEffects = (await raw<{
    preparations: number;
    manualEvents: number;
    campaignProviders: number;
  }[]>`
    select
      (select count(*)::int from pilot_manual_message_preparations) preparations,
      (select count(*)::int from pilot_manual_message_events) "manualEvents",
      (select count(*)::int from campaign_provider_events) "campaignProviders"
  `)[0]!;
  await raw`
    truncate operator_email_test_events,operator_email_test_attempts
    restart identity cascade`;

  const unauthorized = createAuthorizationContext({
    principalId: 'operator-without-email-permission',
    permissions: new Set(),
    authenticationMethod: 'integration-test',
  });
  await expectCode(
    sendOperatorEmailTest(db, input(), unauthorized, runtime, async () => receipt),
    'FORBIDDEN',
  );
  await expectCode(
    sendOperatorEmailTest(
      db,
      input(),
      auth,
      { ...runtime, killSwitchEnabled: true },
      async () => receipt,
    ),
    'KILL_SWITCH_ENGAGED',
  );

  let deliveries = 0;
  const deliver: OperatorEmailDelivery = async (message) => {
    deliveries += 1;
    assert.equal(message.subject, 'Teste interno de e-mail — Lead Finder Brasil');
    assert.match(message.body, /Nenhum lead real está envolvido/);
    return receipt;
  };
  const idempotencyKey = randomUUID();
  const first = await sendOperatorEmailTest(db, input(idempotencyKey), auth, runtime, deliver);
  assert.equal(first.state, 'DELIVERED');
  assert.equal(first.replayed, false);
  assert.equal(deliveries, 1);

  const replay = await sendOperatorEmailTest(db, input(idempotencyKey), auth, runtime, deliver);
  assert.equal(replay.attemptId, first.attemptId);
  assert.equal(replay.state, 'DELIVERED');
  assert.equal(replay.replayed, true);
  assert.equal(deliveries, 1);

  await expectCode(
    sendOperatorEmailTest(
      db,
      input(idempotencyKey),
      auth,
      { ...runtime, authorizedRecipient: 'different@example.test',
        authorizedSender: 'different@example.test' },
      deliver,
    ),
    'IDEMPOTENCY_CONFLICT',
  );

  let releaseDelivery!: () => void;
  const deliveryGate = new Promise<void>((resolve) => {
    releaseDelivery = resolve;
  });
  let concurrentDeliveries = 0;
  const concurrentDelivery: OperatorEmailDelivery = async () => {
    concurrentDeliveries += 1;
    await deliveryGate;
    return receipt;
  };
  const concurrentKey = randomUUID();
  const leader = sendOperatorEmailTest(
    db,
    input(concurrentKey),
    auth,
    runtime,
    concurrentDelivery,
  );
  while (concurrentDeliveries === 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await expectCode(
    sendOperatorEmailTest(
      db,
      input(concurrentKey),
      auth,
      runtime,
      concurrentDelivery,
    ),
    'AMBIGUOUS_STATE',
  );
  releaseDelivery();
  assert.equal((await leader).state, 'DELIVERED');
  assert.equal(concurrentDeliveries, 1);

  let failedDeliveries = 0;
  const failingDelivery: OperatorEmailDelivery = async () => {
    failedDeliveries += 1;
    throw new Error('synthetic Gmail API failure with operator@example.test');
  };
  const failureKey = randomUUID();
  await expectCode(
    sendOperatorEmailTest(db, input(failureKey), auth, runtime, failingDelivery),
    'DELIVERY_FAILED',
  );
  const failedReplay = await sendOperatorEmailTest(
    db,
    input(failureKey),
    auth,
    runtime,
    failingDelivery,
  );
  assert.equal(failedReplay.state, 'FAILED');
  assert.equal(failedReplay.replayed, true);
  assert.equal(failedDeliveries, 1);

  const stored = await raw<{ value: string }[]>`
    select to_jsonb(item)::text value from operator_email_test_attempts item
    union all
    select to_jsonb(item)::text value from operator_email_test_events item`;
  for (const forbidden of [
    runtime.authorizedRecipient,
    auth.principalId,
    idempotencyKey,
    receipt.messageId,
    receipt.response,
    'Nenhum lead real',
  ]) {
    assert.equal(stored.some(({ value }) => value.includes(forbidden)), false);
  }

  await serviceRole.unsafe('SET ROLE service_role');
  await assert.rejects(serviceRole`
    insert into operator_email_test_attempts(
      recipient_fingerprint,sender_fingerprint,operator_principal_fingerprint,
      payload_fingerprint,idempotency_fingerprint,message_fingerprint
    ) values(
      ${'a'.repeat(64)},${'b'.repeat(64)},${'c'.repeat(64)},
      ${'d'.repeat(64)},${'e'.repeat(64)},${'f'.repeat(64)}
    )`);
  await serviceRole.unsafe('RESET ROLE');

  await assert.rejects(raw`
    update operator_email_test_attempts
    set template_version='v2'
    where id=${first.attemptId}::uuid`);
  await assert.rejects(raw`
    delete from operator_email_test_events
    where attempt_id=${first.attemptId}::uuid`);

  const sideEffects = (await raw<{
    preparations: number;
    manualEvents: number;
    campaignProviders: number;
  }[]>`
    select
      (select count(*)::int from pilot_manual_message_preparations) preparations,
      (select count(*)::int from pilot_manual_message_events) "manualEvents",
      (select count(*)::int from campaign_provider_events) "campaignProviders"
  `)[0]!;
  assert.deepEqual(sideEffects, baselineSideEffects);

  console.log(JSON.stringify({
    result: 'OPERATOR_EMAIL_TEST_INTEGRATION_PASS',
    deliveries,
    concurrentDeliveries,
    failedDeliveries,
  }));
} finally {
  await serviceRole.end();
  if (createdServiceRole && serviceRoleGrantedTo) {
    await raw.unsafe(
      `REVOKE service_role FROM ${quoteIdentifier(serviceRoleGrantedTo)}`,
    ).catch(() => undefined);
  }
  if (createdServiceRole) {
    await raw.unsafe('DROP ROLE service_role').catch(() => undefined);
  }
  await close();
  await raw.end();
}
