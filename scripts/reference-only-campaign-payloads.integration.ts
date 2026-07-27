import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const db = postgres(databaseUrl, { max: 1 });
const migration = await readFile(
  new URL('../database/migrations/0023_reference_only_campaign_payloads.sql', import.meta.url),
  'utf8',
);
const marker = 'PII_CAMPAIGN_MARKER_5511888888888_sensitive@example.test';

const assertReferenceOnly = (value: unknown, expectedKeys: readonly string[]) => {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /PII_CAMPAIGN_MARKER|5511888888888|sensitive@example\.test/);
  const object = value as Record<string, unknown>;
  for (const forbidden of [
    'leadName', 'name', 'address', 'phone', 'whatsapp', 'email', 'content', 'message',
    'renderedMessage', 'subject', 'body', 'variables', 'snapshot', 'error', 'stack',
  ]) assert.equal(Object.hasOwn(object, forbidden), false, `forbidden campaign key persisted: ${forbidden}`);
  for (const key of expectedKeys) assert.equal(Object.hasOwn(object, key), true, `expected campaign key missing: ${key}`);
};

async function insertChain(prefix: string) {
  const leadId = randomUUID();
  const campaignId = randomUUID();
  const versionId = randomUUID();
  const recipientId = randomUUID();
  const attemptId = randomUUID();
  const outboxId = randomUUID();
  const providerEventId = randomUUID();
  const deadLetterId = randomUUID();
  const now = new Date().toISOString();

  await db`
    INSERT INTO public.leads(
      id, osm_type, osm_id, name, category, phone, whatsapp, email, address,
      city, state, score, status, qualification_status
    ) VALUES (
      ${leadId}::uuid, 'node', ${`${prefix}-${leadId}`}, ${marker}, 'synthetic',
      '5511888888888', '5511888888888', 'sensitive@example.test', ${marker},
      'Campinas', 'SP', 1, 'SEM_SITE_CADASTRADO', 'SEM_SITE_CONFIRMADO'
    )`;
  await db`
    INSERT INTO public.campaigns(id, name, idempotency_key, payload_fingerprint)
    VALUES (${campaignId}::uuid, ${`${prefix}-${marker}`}, ${`${prefix}-campaign`}, ${'a'.repeat(64)})`;
  await db`
    INSERT INTO public.campaign_versions(id, campaign_id, version_number)
    VALUES (${versionId}::uuid, ${campaignId}::uuid, 1)`;
  await db`
    INSERT INTO public.campaign_recipients(
      id, campaign_id, campaign_version_id, lead_id, channel, recipient_snapshot,
      idempotency_key, payload_fingerprint, available_at
    ) VALUES (
      ${recipientId}::uuid, ${campaignId}::uuid, ${versionId}::uuid, ${leadId}::uuid, 'EMAIL',
      ${JSON.stringify({ leadName: marker, address: marker, email: 'sensitive@example.test' })}::jsonb,
      ${`${prefix}-recipient`}, ${'b'.repeat(64)}, ${now}::timestamptz
    )`;
  await db`
    INSERT INTO public.campaign_attempts(
      id, recipient_id, payload_snapshot, idempotency_key, payload_fingerprint, available_at
    ) VALUES (
      ${attemptId}::uuid, ${recipientId}::uuid,
      ${JSON.stringify({ renderedMessage: marker, subject: marker, variables: { email: 'sensitive@example.test' } })}::jsonb,
      ${`${prefix}-attempt`}, ${'c'.repeat(64)}, ${now}::timestamptz
    )`;
  await db`
    INSERT INTO public.campaign_outbox(
      id, aggregate_type, aggregate_id, event_type, payload, idempotency_key,
      payload_fingerprint, available_at
    ) VALUES (
      ${outboxId}::uuid, 'ATTEMPT', ${attemptId}::uuid, 'ATTEMPT_CREATED',
      ${JSON.stringify({ attemptId, renderedMessage: marker, email: 'sensitive@example.test' })}::jsonb,
      ${`${prefix}-outbox`}, ${'d'.repeat(64)}, ${now}::timestamptz
    )`;
  await db`
    INSERT INTO public.campaign_provider_events(
      id, attempt_id, provider, external_id, event_type, payload,
      payload_fingerprint, occurred_at
    ) VALUES (
      ${providerEventId}::uuid, ${attemptId}::uuid, 'synthetic', ${`${prefix}-external`}, 'DELIVERED',
      ${JSON.stringify({ body: marker, destination: 'sensitive@example.test' })}::jsonb,
      ${'e'.repeat(64)}, ${now}::timestamptz
    )`;
  await db`
    INSERT INTO public.campaign_dead_letters(
      id, outbox_id, cycle, correlation_id, payload, error, error_code,
      attempts, claim_generation, created_at
    ) VALUES (
      ${deadLetterId}::uuid, ${outboxId}::uuid, 0, ${`${prefix}-correlation`},
      ${JSON.stringify({ body: marker, destination: 'sensitive@example.test' })}::jsonb,
      ${marker}, 'SIMULATED_FAILURE', 1, 0, ${now}::timestamptz
    )`;

  return { recipientId, attemptId, outboxId, providerEventId, deadLetterId };
}

async function readPayloads(ids: Awaited<ReturnType<typeof insertChain>>) {
  const recipient = (await db<{ payload: unknown }[]>`
    SELECT recipient_snapshot AS payload FROM public.campaign_recipients
    WHERE id = ${ids.recipientId}::uuid`)[0]!.payload;
  const attempt = (await db<{ payload: unknown }[]>`
    SELECT payload_snapshot AS payload FROM public.campaign_attempts
    WHERE id = ${ids.attemptId}::uuid`)[0]!.payload;
  const outbox = (await db<{ payload: unknown }[]>`
    SELECT payload FROM public.campaign_outbox
    WHERE id = ${ids.outboxId}::uuid`)[0]!.payload;
  const provider = (await db<{ payload: unknown }[]>`
    SELECT payload FROM public.campaign_provider_events
    WHERE id = ${ids.providerEventId}::uuid`)[0]!.payload;
  const deadLetter = (await db<{ payload: unknown; error: string }[]>`
    SELECT payload, error FROM public.campaign_dead_letters
    WHERE id = ${ids.deadLetterId}::uuid`)[0]!;
  return { recipient, attempt, outbox, provider, deadLetter };
}

const verifyPayloads = (payloads: Awaited<ReturnType<typeof readPayloads>>) => {
  assertReferenceOnly(payloads.recipient, [
    'schemaVersion', 'recipientId', 'campaignId', 'campaignVersionId', 'leadId', 'channel', 'state', 'version', 'availableAt',
  ]);
  assertReferenceOnly(payloads.attempt, [
    'schemaVersion', 'attemptId', 'recipientId', 'state', 'version', 'availableAt',
  ]);
  assertReferenceOnly(payloads.outbox, [
    'schemaVersion', 'outboxId', 'aggregateType', 'aggregateId', 'eventType',
  ]);
  assertReferenceOnly(payloads.provider, [
    'schemaVersion', 'providerEventId', 'attemptId', 'provider', 'eventType', 'occurredAt',
  ]);
  assertReferenceOnly(payloads.deadLetter.payload, [
    'schemaVersion', 'deadLetterId', 'outboxId', 'cycle', 'errorCode', 'attempts', 'claimGeneration',
  ]);
  assert.equal(payloads.deadLetter.error, 'SIMULATED_FAILURE');
};

try {
  for (const [table, trigger] of [
    ['campaign_recipients', 'campaign_recipients_reference_payload_guard'],
    ['campaign_attempts', 'campaign_attempts_reference_payload_guard'],
    ['campaign_outbox', 'campaign_outbox_reference_payload_guard'],
    ['campaign_dead_letters', 'campaign_dead_letters_reference_payload_guard'],
    ['campaign_provider_events', 'campaign_provider_events_reference_payload_guard'],
  ] as const) await db.unsafe(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`);

  const dirty = await insertChain('legacy-dirty');

  for (const [table, trigger] of [
    ['campaign_recipients', 'campaign_recipients_reference_payload_guard'],
    ['campaign_attempts', 'campaign_attempts_reference_payload_guard'],
    ['campaign_outbox', 'campaign_outbox_reference_payload_guard'],
    ['campaign_dead_letters', 'campaign_dead_letters_reference_payload_guard'],
    ['campaign_provider_events', 'campaign_provider_events_reference_payload_guard'],
  ] as const) await db.unsafe(`ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`);

  await db.unsafe(migration);
  await db.unsafe(migration);
  verifyPayloads(await readPayloads(dirty));

  const guarded = await insertChain('guarded-new');
  verifyPayloads(await readPayloads(guarded));

  const triggers = await db<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'campaign_recipients_reference_payload_guard',
        'campaign_attempts_reference_payload_guard',
        'campaign_outbox_reference_payload_guard',
        'campaign_dead_letters_reference_payload_guard',
        'campaign_provider_events_reference_payload_guard'
      )`;
  assert.equal(triggers[0]?.count, 5);

  const publicGrants = await db<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_proc procedure_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = procedure_record.pronamespace
    CROSS JOIN LATERAL aclexplode(
      coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
    ) acl
    WHERE namespace_record.nspname = 'public'
      AND procedure_record.proname IN (
        'pii_safe_campaign_reference_payload',
        'sanitize_campaign_reference_payload_on_insert'
      )
      AND acl.grantee = 0`;
  assert.equal(publicGrants[0]?.count, 0);

  console.log(JSON.stringify({
    result: 'REFERENCE_ONLY_CAMPAIGN_PAYLOADS_PASS',
    migrationReplay: 2,
    backfilledPayloads: 5,
    guardedPayloads: 5,
    publicFunctionExecuteGrants: 0,
    forbiddenMarkersPersisted: 0,
  }));
} finally {
  await db.end();
}
