import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { getMigrationSource } from './migration-registry-plan.js';
import { assertImportedMigrationParity, loadMigrationRegistry } from './migration-registry.js';

const execFileAsync = promisify(execFile);
const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required');

const suffix = `${process.pid}_${Date.now()}`;
const databaseName = `migration_registry_${suffix}`;
const ownerName = `migration_registry_owner_${suffix}`;
const ownerPassword = `synthetic-owner-${suffix}`;
const requiredRoles = ['anon', 'authenticated', 'service_role'] as const;
const createdRoles = new Set<string>();
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const admin = postgres(sourceUrl, { max: 1 });
const fixtureUrl = new URL(sourceUrl);
fixtureUrl.pathname = `/${databaseName}`;
fixtureUrl.username = ownerName;
fixtureUrl.password = ownerPassword;

const protectedTriggers = [
  'contact_channel_authorizations_append_only',
  'contact_email_business_evidence_append_only',
  'pilot_manual_message_preparations_append_only',
  'pilot_manual_message_events_append_only',
  'contact_email_business_evidence_validate',
  'pilot_manual_message_transition_guard',
  'campaign_opt_outs_manual_messaging_lock',
] as const;

const protectedFunctions = [
  'validate_email_business_evidence_append',
  'validate_manual_message_transition',
  'lock_manual_messaging_suppression',
  'reject_manual_messaging_history_mutation',
] as const;

type ObjectRow = { kind: string; name: string; oid: number };

async function applySplitHistoryFixture(url: string): Promise<void> {
  const db = postgres(url, { max: 1 });
  const directory = new URL('../database/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  try {
    await db`
      CREATE TABLE public.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const migration = await readFile(new URL(file, directory), 'utf8');
      await db.begin(async (transaction) => {
        await transaction.unsafe(migration);
        if (version < '0019_') {
          await transaction`INSERT INTO public.schema_migrations (version) VALUES (${version})`;
        }
      });
    }

    await db`CREATE SCHEMA supabase_migrations`;
    await db`
      CREATE TABLE supabase_migrations.schema_migrations (
        version text PRIMARY KEY,
        statements text[] NOT NULL DEFAULT '{}',
        name text NOT NULL
      )`;
    await db`
      INSERT INTO supabase_migrations.schema_migrations (version, name)
      VALUES
        ('20260722215045', '0019_manual_assisted_messaging'),
        ('20260722220522', '0020_manual_messaging_append_only_acl')`;
  } finally {
    await db.end();
  }
}

async function snapshotProtectedObjects(db: ReturnType<typeof postgres>): Promise<ObjectRow[]> {
  return db<ObjectRow[]>`
    SELECT 'trigger'::text AS kind, trigger_record.tgname AS name, trigger_record.oid::int AS oid
    FROM pg_trigger trigger_record
    WHERE NOT trigger_record.tgisinternal
      AND trigger_record.tgname IN ${db(protectedTriggers)}
    UNION ALL
    SELECT 'function'::text AS kind, procedure_record.proname AS name, procedure_record.oid::int AS oid
    FROM pg_proc procedure_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = procedure_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND procedure_record.proname IN ${db(protectedFunctions)}
    ORDER BY kind, name`;
}

async function runMigrationRunner(url: string): Promise<string> {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = await execFileAsync(executable, ['run', 'db:migrate'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    maxBuffer: 1024 * 1024,
  });
  return result.stdout;
}

try {
  await admin.unsafe(`CREATE ROLE ${quoteIdentifier(ownerName)} LOGIN PASSWORD '${ownerPassword}'`);
  createdRoles.add(ownerName);
  for (const role of requiredRoles) {
    if ((await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`).length === 0) {
      await admin.unsafe(`CREATE ROLE ${quoteIdentifier(role)} NOLOGIN`);
      createdRoles.add(role);
    }
  }
  await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER ${quoteIdentifier(ownerName)}`);
  await applySplitHistoryFixture(fixtureUrl.toString());

  const db = postgres(fixtureUrl.toString(), { max: 1 });
  try {
    const registry = await loadMigrationRegistry(db);
    assert.equal(getMigrationSource(registry, '0019_manual_assisted_messaging'), 'SUPABASE');
    assert.equal(getMigrationSource(registry, '0020_manual_messaging_append_only_acl'), 'SUPABASE');
    await assertImportedMigrationParity(db, '0019_manual_assisted_messaging', 'SUPABASE');
    await assertImportedMigrationParity(db, '0020_manual_messaging_append_only_acl', 'SUPABASE');

    const before = await snapshotProtectedObjects(db);
    assert.equal(before.length, protectedTriggers.length + protectedFunctions.length);

    const firstOutput = await runMigrationRunner(fixtureUrl.toString());
    const secondOutput = await runMigrationRunner(fixtureUrl.toString());
    assert.match(firstOutput, /0019_manual_assisted_messaging already applied \(source=SUPABASE\)/);
    assert.match(firstOutput, /0020_manual_messaging_append_only_acl already applied \(source=SUPABASE\)/);
    assert.match(secondOutput, /0019_manual_assisted_messaging already applied \(source=SUPABASE\)/);
    assert.match(secondOutput, /0020_manual_messaging_append_only_acl already applied \(source=SUPABASE\)/);

    const localImportedRows = await db<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM public.schema_migrations
      WHERE version IN ('0019_manual_assisted_messaging', '0020_manual_messaging_append_only_acl')`;
    assert.equal(localImportedRows[0]?.count, 0);

    const after = await snapshotProtectedObjects(db);
    assert.deepEqual(after, before);

    console.log(
      JSON.stringify({
        result: 'MIGRATION_REGISTRY_COMPATIBILITY_PASS',
        importedMigrations: 2,
        runnerExecutions: 2,
        localHistoryWrites: 0,
        protectedObjectsChanged: 0,
      }),
    );
  } finally {
    await db.end();
  }
} finally {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch(() => undefined);
  for (const role of [ownerName, ...[...requiredRoles].reverse()]) {
    if (createdRoles.has(role)) await admin.unsafe(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`).catch(() => undefined);
  }
  await admin.end();
}
