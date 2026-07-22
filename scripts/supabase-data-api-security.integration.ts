import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';

const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required');

const suffix = `${process.pid}_${Date.now()}`;
const databaseName = `data_api_security_${suffix}`;
const ownerName = `migration_owner_${suffix}`;
const ownerPassword = `synthetic-owner-${suffix}`;
const roleNames = ['anon', 'authenticated', 'service_role'] as const;
const createdRoles = new Set<string>();
const admin = postgres(sourceUrl, { max: 1 });
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

const fixtureUrl = new URL(sourceUrl);
fixtureUrl.pathname = `/${databaseName}`;
fixtureUrl.username = ownerName;
fixtureUrl.password = ownerPassword;

async function applyMigrationsTwice(url: string) {
  const db = postgres(url, { max: 1 });
  const directory = new URL('../database/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      await db`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
      for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if ((await db`SELECT 1 FROM schema_migrations WHERE version = ${version}`).length > 0) continue;
        const migration = await readFile(new URL(file, directory), 'utf8');
        await db.begin(async (transaction) => {
          await transaction.unsafe(migration);
          await transaction`INSERT INTO schema_migrations (version) VALUES (${version})`;
        });
      }
    }
    const hardening = await readFile(new URL('../database/migrations/0017_restore_suppression_security_hardening.sql', import.meta.url), 'utf8');
    await db.unsafe(hardening);
    await db.unsafe(hardening);
  } finally {
    await db.end();
  }
}

try {
  await admin.unsafe(`CREATE ROLE ${quoteIdentifier(ownerName)} LOGIN PASSWORD '${ownerPassword}'`);
  createdRoles.add(ownerName);
  for (const role of roleNames) {
    if ((await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`).length === 0) {
      await admin.unsafe(`CREATE ROLE ${quoteIdentifier(role)} NOLOGIN`);
      createdRoles.add(role);
    }
  }
  await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER ${quoteIdentifier(ownerName)}`);
  await applyMigrationsTwice(fixtureUrl.toString());

  const db = postgres(fixtureUrl.toString(), { max: 1 });
  try {
    const table = await db<{ relrowsecurity: boolean; owner: string }[]>`
      SELECT c.relrowsecurity, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'restore_suppression_runs'`;
    assert.deepEqual(table[0], { relrowsecurity: true, owner: ownerName });

    const exposedTables = await db<{ count: number }[]>`
      SELECT count(*)::int AS count FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('PUBLIC', 'anon', 'authenticated')`;
    assert.equal(exposedTables[0]?.count, 0, 'Data API roles must have zero table grants');

    const tablesWithoutRls = await db<{ name: string }[]>`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
      ORDER BY c.relname`;
    assert.equal(tablesWithoutRls.length, 0, `repository tables without RLS: ${JSON.stringify(tablesWithoutRls)}`);

    const routine = await db<{ searchPath: string[] | null; exposed: number }[]>`
      SELECT p.proconfig AS "searchPath",
        (SELECT count(*)::int FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         LEFT JOIN pg_roles r ON r.oid = acl.grantee
         WHERE (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated')) AND acl.privilege_type = 'EXECUTE') AS exposed
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'protect_restore_suppression_run'`;
    assert.deepEqual(routine[0]?.searchPath, ['search_path=pg_catalog, public']);
    assert.equal(routine[0]?.exposed, 0, 'trigger function must not be executable by Data API roles or PUBLIC');

    await db.unsafe(`
      CREATE TABLE public.security_future_table (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
      CREATE SEQUENCE public.security_future_sequence;
      CREATE FUNCTION public.security_future_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
    `);
    const exposedFutureObjects = await db<{ kind: string; objectName: string; grantee: string; privilege: string }[]>`
      SELECT kind, object_name AS "objectName", grantee, privilege FROM (
        SELECT 'table' AS kind, table_name AS object_name, grantee, privilege_type AS privilege
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'security_future_table' AND grantee IN ('PUBLIC', 'anon', 'authenticated')
        UNION ALL
        SELECT 'sequence', object_name, grantee, privilege_type FROM information_schema.role_usage_grants
        WHERE object_schema = 'public' AND object_name IN ('security_future_sequence', 'security_future_table_id_seq') AND grantee IN ('PUBLIC', 'anon', 'authenticated')
        UNION ALL
        SELECT 'function', routine_name, grantee, privilege_type FROM information_schema.routine_privileges
        WHERE specific_schema = 'public' AND routine_name = 'security_future_function' AND grantee IN ('PUBLIC', 'anon', 'authenticated')
      ) exposed ORDER BY kind, object_name, grantee, privilege`;
    assert.equal(exposedFutureObjects.length, 0, `future object grants exposed to Data API roles: ${JSON.stringify(exposedFutureObjects)}`);

    const policies = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_policies WHERE schemaname = 'public'`;
    assert.equal(policies[0]?.count, 0, 'hardening must not create permissive policies');
  } finally {
    await db.end();
  }
  console.log(JSON.stringify({ result: 'SUPABASE_DATA_API_DENY_ALL_VERIFIED', ownerProfile: 'non-postgres', policies: 0 }));
} finally {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch(() => undefined);
  for (const role of [ownerName, ...[...roleNames].reverse()]) {
    if (createdRoles.has(role)) await admin.unsafe(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`).catch(() => undefined);
  }
  await admin.end();
}
