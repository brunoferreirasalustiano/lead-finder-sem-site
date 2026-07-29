import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';

const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required');
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const migrationsUrl = new URL('../database/migrations/', import.meta.url);
const databaseName = `lf_narrow_diag_${randomUUID().replaceAll('-', '')}`.slice(0, 63);
const scenarioUrl = new URL(sourceUrl);
scenarioUrl.pathname = `/${databaseName}`;
const administrator = postgres(sourceUrl, { max: 1 });
let client: ReturnType<typeof postgres> | undefined;

try {
  await administrator.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  client = postgres(scenarioUrl.toString(), { max: 1 });
  const baselineMigrations = (await readdir(migrationsUrl))
    .filter((file) => /^\d{4}.*\.sql$/.test(file) && file < '0025_narrow_contact_resolution.sql')
    .sort();
  for (const file of baselineMigrations) {
    await client.unsafe(await readFile(new URL(file, migrationsUrl), 'utf8'));
  }

  const snapshot = {
    channel: 'WHATSAPP',
    templateId: 'pilot-whatsapp-first-contact',
    templateVersion: 'v1',
    variables: { EMPRESA: 'Empresa Legada', FONTE: 'PUBLIC_BUSINESS_SOURCE' },
    contactFingerprint: 'a'.repeat(64),
    messageFingerprint: 'b'.repeat(64),
  };
  const evaluation = (await client<{
    type: string;
    hasRequired: boolean;
    hasForbidden: boolean;
    definition: string;
  }[]>`
    select
      jsonb_typeof(${JSON.stringify(snapshot)}::jsonb) type,
      ${JSON.stringify(snapshot)}::jsonb ?&
        array['channel','templateId','templateVersion','variables','contactFingerprint','messageFingerprint']
        "hasRequired",
      ${JSON.stringify(snapshot)}::jsonb ?|
        array['message','subject','link','url','contactValue'] "hasForbidden",
      pg_get_constraintdef(oid) definition
    from pg_constraint
    where conrelid='public.pilot_manual_message_preparations'::regclass
      and conname='pilot_manual_message_preparations_result_snapshot_check'
  `)[0];
  console.log(JSON.stringify({
    result: 'NARROW_CONTACT_P1_SCHEMA_DIAGNOSTIC',
    baselineMigrations,
    evaluation,
  }));
} finally {
  await client?.end().catch(() => undefined);
  await administrator.unsafe(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
  ).catch(() => undefined);
  await administrator.end();
}
