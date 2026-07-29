import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { createDatabase, createOpportunity } from '@lead-finder/database';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const raw = postgres(databaseUrl, { max: 1 });
const database = createDatabase(databaseUrl, { max: 4 });
const migration = await readFile(
  new URL('../database/migrations/0024_crm_idempotency_safe_results.sql', import.meta.url),
  'utf8',
);
const evidencePath = new URL('../artifacts/pilot-readiness.json', import.meta.url);
const syntheticSensitivePhone = '+12025550101';
const syntheticSensitiveEmail = 'empresa@example.test';
const marker =
  `PII_CRM_REPLAY_MARKER_${syntheticSensitiveEmail}_${syntheticSensitivePhone}`;
const leadId = randomUUID();
let stage = 'INITIALIZE';

const writeFailureEvidence = async (error: unknown) => {
  const candidate = error as { name?: unknown; code?: unknown };
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({
    evidenceType: 'CRM_IDEMPOTENCY_SAFE_RESULTS_FAILURE',
    result: 'FAIL',
    stage,
    errorName: typeof candidate?.name === 'string' ? candidate.name : 'UNKNOWN',
    errorCode: typeof candidate?.code === 'string' ? candidate.code : 'UNKNOWN',
  }, null, 2));
};

const assertSafe = (value: unknown) => {
  const serialized = JSON.stringify(value);
  assert.equal(
    serialized.includes('PII_CRM_REPLAY_MARKER'),
    false,
    'CRM replay marker persisted',
  );
  assert.equal(
    serialized.includes(syntheticSensitivePhone),
    false,
    'synthetic phone persisted',
  );
  assert.equal(
    serialized.includes(syntheticSensitiveEmail),
    false,
    'synthetic email persisted',
  );
  assert.doesNotMatch(serialized, /"(?:name|title|body|description|owner|author|lossReason|crmOwner)"/);
};

try {
  stage = 'INSERT_ELIGIBLE_LEAD';
  await raw`
    INSERT INTO public.leads(
      id, osm_type, osm_id, name, category, phone, whatsapp, email, address,
      city, state, score, status, qualification_status, crm_stage
    ) VALUES (
      ${leadId}::uuid, 'node', ${`crm-replay-${leadId}`}, ${marker}, 'synthetic',
      ${syntheticSensitivePhone}, ${syntheticSensitivePhone}, ${syntheticSensitiveEmail}, ${marker},
      'Campinas', 'SP', 1, 'SEM_SITE_CADASTRADO', 'SEM_SITE_CONFIRMADO', 'NOVO'
    )`;

  stage = 'INSERT_DIRTY_LEGACY_RESULTS';
  await raw`ALTER TABLE public.crm_idempotency_keys DISABLE TRIGGER USER`;
  try {
    for (const [index, resourceType] of ['lead', 'opportunity', 'note', 'tag', 'task'].entries()) {
      const resourceId = randomUUID();
      await raw`
        INSERT INTO public.crm_idempotency_keys(
          scope, idempotency_key, payload_fingerprint, resource_type, resource_id, result
        ) VALUES (
          ${`legacy:${resourceType}:${index}`},
          ${`legacy-key-${resourceType}-${index}`},
          ${String(index).repeat(64).slice(0, 64)},
          ${resourceType},
          ${resourceId}::uuid,
          ${raw.json({
            id: resourceId,
            leadId,
            name: marker,
            title: marker,
            body: marker,
            description: marker,
            owner: marker,
            author: marker,
            lossReason: marker,
            crmOwner: marker,
            phone: syntheticSensitivePhone,
            email: syntheticSensitiveEmail,
            qualificationStatus: 'SEM_SITE_CONFIRMADO',
            isBlocked: false,
            doNotContact: false,
            crmStage: 'NOVO',
            crmPriority: 'MEDIA',
            crmNextActionAt: null,
            crmVersion: 1,
            crmUpdatedAt: null,
            amount: '1000.00',
            currency: 'BRL',
            expectedCloseAt: null,
            closedAt: null,
            outcome: null,
            opportunityId: null,
            removed: resourceType === 'tag' && index % 2 === 1,
            status: 'PENDENTE',
            priority: 'MEDIA',
            dueAt: '2030-02-01T00:00:00.000Z',
            completedAt: null,
            version: 1,
            createdAt: '2030-01-01T00:00:00.000Z',
            updatedAt: '2030-01-01T00:00:00.000Z',
          })}
        )`;
    }
  } finally {
    await raw`ALTER TABLE public.crm_idempotency_keys ENABLE TRIGGER USER`;
  }

  stage = 'APPLY_MIGRATION_FIRST_PASS';
  await raw.unsafe(migration);
  stage = 'APPLY_MIGRATION_REPLAY';
  await raw.unsafe(migration);

  stage = 'VERIFY_BACKFILL';
  const legacyRows = await raw<{ resourceType: string; result: unknown }[]>`
    SELECT resource_type AS "resourceType", result
    FROM public.crm_idempotency_keys
    WHERE scope LIKE 'legacy:%'
    ORDER BY resource_type`;
  assert.equal(legacyRows.length, 5);
  for (const legacy of legacyRows) {
    assertSafe(legacy.result);
    const object = legacy.result as Record<string, unknown>;
    assert.equal(object['schemaVersion'], 1);
    assert.equal(object['resourceType'], legacy.resourceType);
    assert.equal(typeof object['id'] === 'string' || typeof object['tagId'] === 'string', true);
  }

  stage = 'VERIFY_FIRST_RESPONSE_AND_REPLAY';
  const input = {
    title: marker,
    value: '1500.00',
    expectedCloseAt: '2030-03-01T00:00:00.000Z',
    owner: marker,
    actor: 'integration-test',
    idempotencyKey: randomUUID(),
  };
  const first = await createOpportunity(database.db, leadId, input);
  const replay = await createOpportunity(database.db, leadId, input);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.data, first.data);
  assert.equal(Object.hasOwn(first.data, 'closedAt'), true);
  assert.equal(Object.hasOwn(first.data, 'outcome'), true);
  assertSafe(first.data);

  stage = 'VERIFY_STORED_RESULT';
  const stored = (await raw<{ result: unknown }[]>`
    SELECT result FROM public.crm_idempotency_keys
    WHERE scope = ${`lead:${leadId}:opportunity:create`}
      AND idempotency_key = ${input.idempotencyKey}`)[0]?.result;
  assert.ok(stored);
  assert.deepEqual(stored, first.data);
  assertSafe(stored);

  stage = 'VERIFY_TRIGGER_AND_ACL';
  const triggerRows = await raw<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname = 'crm_idempotency_result_pii_guard'`;
  assert.equal(triggerRows[0]?.count, 1);
  const exposed = await raw<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_proc procedure_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = procedure_record.pronamespace
    CROSS JOIN LATERAL aclexplode(
      coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
    ) acl
    WHERE namespace_record.nspname = 'public'
      AND procedure_record.proname IN (
        'pii_safe_crm_idempotency_result',
        'sanitize_crm_idempotency_result'
      )
      AND acl.grantee = 0`;
  assert.equal(exposed[0]?.count, 0);

  console.log(JSON.stringify({
    result: 'CRM_IDEMPOTENCY_SAFE_RESULTS_PASS',
    migrationReplay: 2,
    legacyResourceTypes: 5,
    deterministicFirstReplay: true,
    explicitNullFieldsPreserved: true,
    historicalContractReconciled: true,
    forbiddenMarkersPersisted: 0,
    publicFunctionExecuteGrants: 0,
  }));
} catch (error) {
  await writeFailureEvidence(error);
  throw error;
} finally {
  await raw`DELETE FROM public.crm_idempotency_keys WHERE scope LIKE 'legacy:%'`.catch(() => undefined);
  await raw`DELETE FROM public.leads WHERE id = ${leadId}::uuid`.catch(() => undefined);
  await database.close().catch(() => undefined);
  await raw.end();
}
