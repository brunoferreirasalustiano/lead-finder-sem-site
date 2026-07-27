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
const leadId = randomUUID();
const qualificationId = randomUUID();
const timelineId = randomUUID();
const marker = 'PII_MARKER_5511999999999_private@example.test';

const shape = (value: unknown) => ({
  kind: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
  keys: typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).sort()
    : [],
  markerPresent: /PII_MARKER|5511999999999|private@example\.test/.test(JSON.stringify(value)),
});

try {
  await db`
    INSERT INTO public.leads(
      id, osm_type, osm_id, name, category, phone, whatsapp, email, address,
      city, state, score, status, qualification_status
    ) VALUES (
      ${leadId}::uuid, 'node', ${`pii-shape-${leadId}`}, ${marker}, 'synthetic',
      '5511999999999', '5511999999999', 'private@example.test', ${marker},
      'Campinas', 'SP', 1, 'SEM_SITE_CADASTRADO', 'PENDENTE'
    )`;

  await db`ALTER TABLE public.lead_qualification_history DISABLE TRIGGER USER`;
  await db`ALTER TABLE public.crm_timeline_events DISABLE TRIGGER USER`;
  try {
    await db`
      INSERT INTO public.lead_qualification_history(
        id, lead_id, event_type, previous_value, new_value, actor, source, reason
      ) VALUES (
        ${qualificationId}::uuid, ${leadId}::uuid, 'CONTACT_UPDATED',
        ${JSON.stringify({
          id: randomUUID(), leadId, type: 'TELEFONE', originalValue: marker,
          normalizedValue: '5511999999999', source: marker, notes: marker,
          isValid: true, possibleWhatsapp: true,
        })}::jsonb,
        ${JSON.stringify({
          id: randomUUID(), leadId, type: 'EMAIL', originalValue: 'private@example.test',
          normalizedValue: 'private@example.test', source: marker, notes: marker,
          isValid: true, possibleWhatsapp: false,
        })}::jsonb,
        'synthetic-actor', 'integration-test', ${marker}
      )`;

    await db`
      INSERT INTO public.crm_timeline_events(
        id, lead_id, event_type, actor, reason, previous_value, new_value, metadata
      ) VALUES (
        ${timelineId}::uuid, ${leadId}::uuid, 'NOTE_ADDED', 'synthetic-actor', ${marker}, NULL,
        ${JSON.stringify({
          id: randomUUID(), leadId, body: marker, author: marker,
          title: marker, description: marker, createdAt: new Date().toISOString(),
        })}::jsonb,
        ${JSON.stringify({ principalId: marker, source: 'integration-test', arbitrary: marker })}::jsonb
      )`;
  } finally {
    await db`ALTER TABLE public.lead_qualification_history ENABLE TRIGGER USER`;
    await db`ALTER TABLE public.crm_timeline_events ENABLE TRIGGER USER`;
  }

  await db.unsafe(migration);
  await db.unsafe(migration);

  const qualification = (
    await db<{ previousValue: unknown; newValue: unknown }[]>`
      SELECT previous_value AS "previousValue", new_value AS "newValue"
      FROM public.lead_qualification_history
      WHERE id = ${qualificationId}::uuid`
  )[0];
  const timeline = (
    await db<{ newValue: unknown; metadata: unknown }[]>`
      SELECT new_value AS "newValue", metadata
      FROM public.crm_timeline_events
      WHERE id = ${timelineId}::uuid`
  )[0];

  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({
    evidenceType: 'PERSISTED_PII_AUDIT_SHAPE_DIAGNOSTIC',
    result: 'DIAGNOSTIC_COMPLETE',
    qualificationPrevious: shape(qualification?.previousValue),
    qualificationNew: shape(qualification?.newValue),
    timelineNew: shape(timeline?.newValue),
    timelineMetadata: shape(timeline?.metadata),
  }, null, 2));

  throw new Error('PERSISTED_PII_AUDIT_SHAPE_DIAGNOSTIC_COMPLETE');
} finally {
  await db`DELETE FROM public.leads WHERE id = ${leadId}::uuid`.catch(() => undefined);
  await db.end();
}
