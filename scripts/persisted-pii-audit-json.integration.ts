import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const db = postgres(databaseUrl, { max: 1 });
const migration = await readFile(
  new URL('../database/migrations/0022_persisted_pii_audit_json.sql', import.meta.url),
  'utf8',
);
const evidencePath = new URL('../artifacts/pilot-readiness.json', import.meta.url);
const allowedPhone = '+12025550100';
const marker = `PII_MARKER_${allowedPhone}_private@example.test`;
const technicalPrincipalId = 'integration-principal';
const dirtyTimelineActor = 'synthetic-actor-backfill';
const guardedTimelineActor = 'synthetic-actor-guard';
const leadId = randomUUID();
const dirtyQualificationId = randomUUID();
const dirtyTimelineId = randomUUID();
const guardedQualificationId = randomUUID();
const guardedTimelineId = randomUUID();
let stage = 'INITIALIZE';

const safeAssertionDetail = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const firstLine = message.split('\n', 1)[0] ?? '';
  return /^(?:expected key missing|forbidden key persisted): [A-Za-z][A-Za-z0-9_]*$/.test(firstLine)
    ? firstLine
    : 'UNCLASSIFIED_ASSERTION';
};
const writeFailureEvidence = async (error: unknown) => {
  const candidate = error as { name?: unknown; code?: unknown };
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({
    evidenceType: 'PERSISTED_PII_AUDIT_FAILURE',
    result: 'FAIL',
    stage,
    errorName: typeof candidate?.name === 'string' ? candidate.name : 'UNKNOWN',
    errorCode: typeof candidate?.code === 'string' ? candidate.code : 'UNKNOWN',
    detail: safeAssertionDetail(error),
  }, null, 2));
};

const assertSanitized = (value: unknown, expectedKeys: readonly string[]) => {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /PII_MARKER|private@example\.test/);
  assert.equal(serialized.includes(allowedPhone), false, 'allowed phone fixture persisted');
  for (const forbidden of [
    'originalValue', 'normalizedValue', 'original_value', 'normalized_value',
    'phone', 'whatsapp', 'email', 'address', 'latitude', 'longitude',
    'body', 'author', 'title', 'description', 'completionNote', 'owner',
    'principalId', 'notes', 'reference',
  ]) assert.equal(Object.hasOwn(value as object, forbidden), false, `forbidden key persisted: ${forbidden}`);
  for (const key of expectedKeys) assert.equal(Object.hasOwn(value as object, key), true, `expected key missing: ${key}`);
};

try {
  stage = 'INSERT_LEAD';
  await db`
    INSERT INTO public.leads(
      id, osm_type, osm_id, name, category, phone, whatsapp, email, address,
      city, state, score, status, qualification_status
    ) VALUES (
      ${leadId}::uuid, 'node', ${`pii-audit-${leadId}`}, ${marker}, 'synthetic',
      ${allowedPhone}, ${allowedPhone}, 'private@example.test', ${marker},
      'Campinas', 'SP', 1, 'SEM_SITE_CADASTRADO', 'PENDENTE'
    )`;

  stage = 'INSERT_DIRTY_LEGACY_ROWS';
  await db`ALTER TABLE public.lead_qualification_history DISABLE TRIGGER USER`;
  await db`ALTER TABLE public.crm_timeline_events DISABLE TRIGGER USER`;
  try {
    await db`
      INSERT INTO public.lead_qualification_history(
        id, lead_id, event_type, previous_value, new_value, actor, source, reason
      ) VALUES (
        ${dirtyQualificationId}::uuid,
        ${leadId}::uuid,
        'CONTACT_UPDATED',
        ${db.json({
          id: randomUUID(), leadId, type: 'TELEFONE', originalValue: marker,
          normalizedValue: allowedPhone, source: marker, notes: marker,
          isValid: true, possibleWhatsapp: true,
        })},
        ${db.json({
          id: randomUUID(), leadId, type: 'EMAIL', originalValue: 'private@example.test',
          normalizedValue: 'private@example.test', source: marker, notes: marker,
          isValid: true, possibleWhatsapp: false,
        })},
        'synthetic-actor', 'integration-test', ${marker}
      )`;

    await db`
      INSERT INTO public.crm_timeline_events(
        id, lead_id, event_type, actor, reason, previous_value, new_value, metadata
      ) VALUES (
        ${dirtyTimelineId}::uuid,
        ${leadId}::uuid,
        'NOTE_ADDED',
        ${dirtyTimelineActor},
        ${marker},
        NULL,
        ${db.json({
          id: randomUUID(), leadId, body: marker, author: marker,
          title: marker, description: marker, createdAt: new Date().toISOString(),
        })},
        ${db.json({ principalId: technicalPrincipalId, source: 'integration-test', arbitrary: marker })}
      )`;
  } finally {
    await db`ALTER TABLE public.lead_qualification_history ENABLE TRIGGER USER`;
    await db`ALTER TABLE public.crm_timeline_events ENABLE TRIGGER USER`;
  }

  stage = 'APPLY_MIGRATION_FIRST_PASS';
  await db.unsafe(migration);
  const timelineAfterFirstPass = (
    await db<{ actor: string; metadata: unknown }[]>`
      SELECT actor, metadata
      FROM public.crm_timeline_events
      WHERE id = ${dirtyTimelineId}::uuid`
  )[0]!;
  assert.equal(timelineAfterFirstPass.actor, dirtyTimelineActor);
  assertSanitized(timelineAfterFirstPass.metadata, ['schemaVersion', 'source']);

  stage = 'APPLY_MIGRATION_REPLAY';
  await db.unsafe(migration);

  stage = 'VERIFY_BACKFILL';
  const dirtyQualification = (
    await db<{ previousValue: unknown; newValue: unknown }[]>`
      SELECT previous_value AS "previousValue", new_value AS "newValue"
      FROM public.lead_qualification_history
      WHERE id = ${dirtyQualificationId}::uuid`
  )[0]!;
  assertSanitized(dirtyQualification.previousValue, ['schemaVersion', 'contactId', 'leadId', 'type', 'isValid']);
  assertSanitized(dirtyQualification.newValue, ['schemaVersion', 'contactId', 'leadId', 'type', 'isValid']);

  const dirtyTimeline = (
    await db<{ actor: string; newValue: unknown; metadata: unknown }[]>`
      SELECT actor, new_value AS "newValue", metadata
      FROM public.crm_timeline_events
      WHERE id = ${dirtyTimelineId}::uuid`
  )[0]!;
  assert.equal(dirtyTimeline.actor, dirtyTimelineActor);
  assertSanitized(dirtyTimeline.newValue, ['schemaVersion', 'noteId', 'leadId', 'createdAt']);
  assertSanitized(dirtyTimeline.metadata, ['schemaVersion', 'source']);

  stage = 'INSERT_GUARDED_ROWS';
  await db`
    INSERT INTO public.lead_qualification_history(
      id, lead_id, event_type, previous_value, new_value, actor, source, reason
    ) VALUES (
      ${guardedQualificationId}::uuid,
      ${leadId}::uuid,
      'CONTACT_ADDED',
      NULL,
      ${db.json({
        id: randomUUID(), leadId, type: 'TELEFONE', originalValue: marker,
        normalizedValue: allowedPhone, source: marker, isValid: true,
        possibleWhatsapp: true, createdAt: new Date().toISOString(),
      })},
      'synthetic-actor', 'integration-test', ${marker}
    )`;

  await db`
    INSERT INTO public.crm_timeline_events(
      id, lead_id, event_type, actor, reason, previous_value, new_value, metadata
    ) VALUES (
      ${guardedTimelineId}::uuid,
      ${leadId}::uuid,
      'TASK_CREATED',
      ${guardedTimelineActor},
      ${marker},
      NULL,
      ${db.json({
        id: randomUUID(), leadId, title: marker, description: marker, owner: marker,
        status: 'PENDENTE', priority: 'MEDIA', dueAt: new Date().toISOString(),
        version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })},
      ${db.json({ principalId: technicalPrincipalId, source: 'integration-test', arbitrary: marker })}
    )`;

  stage = 'VERIFY_GUARDS';
  const guardedQualification = (
    await db<{ newValue: unknown }[]>`
      SELECT new_value AS "newValue"
      FROM public.lead_qualification_history
      WHERE id = ${guardedQualificationId}::uuid`
  )[0]!;
  assertSanitized(guardedQualification.newValue, ['schemaVersion', 'contactId', 'leadId', 'type', 'isValid']);

  const guardedTimeline = (
    await db<{ actor: string; newValue: unknown; metadata: unknown }[]>`
      SELECT actor, new_value AS "newValue", metadata
      FROM public.crm_timeline_events
      WHERE id = ${guardedTimelineId}::uuid`
  )[0]!;
  assert.equal(guardedTimeline.actor, guardedTimelineActor);
  assertSanitized(guardedTimeline.newValue, ['schemaVersion', 'taskId', 'leadId', 'status', 'dueAt']);
  assertSanitized(guardedTimeline.metadata, ['schemaVersion', 'source']);

  stage = 'VERIFY_TRIGGER_AND_ACL';
  const triggerRows = await db<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN ('lead_qualification_history_pii_guard', 'crm_timeline_events_pii_guard')`;
  assert.equal(triggerRows[0]?.count, 2);

  const exposed = await db<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_proc procedure_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = procedure_record.pronamespace
    CROSS JOIN LATERAL aclexplode(
      coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
    ) acl
    WHERE namespace_record.nspname = 'public'
      AND procedure_record.proname IN (
        'pii_safe_qualification_audit_value',
        'pii_safe_crm_audit_value',
        'pii_safe_crm_audit_metadata',
        'sanitize_qualification_history_pii',
        'sanitize_crm_timeline_pii'
      )
      AND acl.grantee = 0`;
  assert.equal(exposed[0]?.count, 0);

  console.log(JSON.stringify({
    result: 'PERSISTED_PII_AUDIT_JSON_PASS',
    migrationReplay: 2,
    backfilledRows: 2,
    guardedRows: 2,
    principalIdsPersisted: 0,
    timelineActorsPreserved: true,
    publicFunctionExecuteGrants: 0,
    forbiddenMarkersPersisted: 0,
  }));
} catch (error) {
  await writeFailureEvidence(error);
  throw error;
} finally {
  await db`DELETE FROM public.leads WHERE id = ${leadId}::uuid`.catch(() => undefined);
  await db.end();
}
