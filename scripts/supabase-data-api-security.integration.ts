import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';

type Database = ReturnType<typeof postgres>;
type Finding = { category: string; objectType: string; objectName: string; grantee: string; privilege: string };

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

async function seedSupabaseDefaults(url: string) {
  const db = postgres(url, { max: 1 });
  try {
    await db.unsafe(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
    `);
  } finally {
    await db.end();
  }
}

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

async function detectDenyAllViolations(db: Database): Promise<Finding[]> {
  return db<Finding[]>`
    WITH relation_acl AS (
      SELECT
        'acl'::text AS category,
        CASE c.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' ELSE 'table' END AS object_type,
        c.relname AS object_name,
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,
        acl.privilege_type AS privilege
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))) acl
      LEFT JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))
    ), function_acl AS (
      SELECT
        'acl'::text AS category,
        'function'::text AS object_type,
        p.oid::regprocedure::text AS object_name,
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,
        acl.privilege_type AS privilege
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      LEFT JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public'
        AND acl.privilege_type = 'EXECUTE'
        AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))
    ), rls AS (
      SELECT 'rls'::text, 'table'::text, c.relname, 'PUBLIC'::text, 'DISABLED'::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    ), policies AS (
      SELECT 'policy'::text, 'table'::text, tablename, coalesce(array_to_string(roles, ','), 'PUBLIC'), policyname
      FROM pg_policies WHERE schemaname = 'public'
    ), search_paths AS (
      SELECT 'search_path'::text, 'function'::text, p.oid::regprocedure::text, 'owner'::text, coalesce(array_to_string(p.proconfig, ','), 'UNSET')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, public'], false)
    )
    SELECT category, object_type AS "objectType", object_name AS "objectName", grantee, privilege FROM relation_acl
    UNION ALL SELECT category, object_type, object_name, grantee, privilege FROM function_acl
    UNION ALL SELECT * FROM rls
    UNION ALL SELECT * FROM policies
    UNION ALL SELECT * FROM search_paths
    ORDER BY 1, 2, 3, 4, 5`;
}

const assertDenyAll = async (db: Database, context: string) => {
  const findings = await detectDenyAllViolations(db);
  assert.equal(findings.length, 0, `${context}: ${JSON.stringify(findings)}`);
};

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
  await seedSupabaseDefaults(fixtureUrl.toString());
  await applyMigrationsTwice(fixtureUrl.toString());

  const db = postgres(fixtureUrl.toString(), { max: 1 });
  try {
    await assertDenyAll(db, 'repository migrations must be deny-all');

    const table = await db<{ relrowsecurity: boolean; owner: string }[]>`
      SELECT c.relrowsecurity, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'restore_suppression_runs'`;
    assert.deepEqual(table[0], { relrowsecurity: true, owner: ownerName });

    await db.unsafe(`
      GRANT ALL ON TABLE public.restore_suppression_runs TO service_role;
      ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    `);
    const reconciliation = await readFile(new URL('../database/migrations/0018_service_role_least_privilege_reconciliation.sql', import.meta.url), 'utf8');
    await db.unsafe(reconciliation);
    await db.unsafe(reconciliation);
    console.log(JSON.stringify({ result: 'SERVICE_ROLE_EMERGENCY_DRIFT_RECONCILED', replay: 2 }));

    await db.unsafe(`
      CREATE TABLE public.security_future_table (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
      ALTER TABLE public.security_future_table ENABLE ROW LEVEL SECURITY;
      CREATE SEQUENCE public.security_future_sequence;
      CREATE FUNCTION public.security_future_function() RETURNS integer
        LANGUAGE sql SET search_path = pg_catalog, public AS 'SELECT 1';
    `);
    await assertDenyAll(db, 'objects created after migration 0018 must be deny-all');

    const serviceAccess = await db<{
      currentSelect: boolean;
      currentInsert: boolean;
      currentUpdate: boolean;
      currentDelete: boolean;
      currentTruncate: boolean;
      currentReferences: boolean;
      currentTrigger: boolean;
      currentFunction: boolean;
      futureSelect: boolean;
      futureInsert: boolean;
      futureUpdate: boolean;
      futureDelete: boolean;
      futureTruncate: boolean;
      futureReferences: boolean;
      futureTrigger: boolean;
      futureSequence: boolean;
      futureFunction: boolean;
    }[]>`
      SELECT
        has_table_privilege('service_role', 'public.restore_suppression_runs', 'SELECT') AS "currentSelect",
        has_table_privilege('service_role', 'public.restore_suppression_runs', 'INSERT') AS "currentInsert",
        has_table_privilege('service_role', 'public.restore_suppression_runs', 'UPDATE') AS "currentUpdate",
        has_table_privilege('service_role', 'public.restore_suppression_runs', 'DELETE') AS "currentDelete",
        has_table_privilege('service_role', 'public.restore_suppression_runs', 'TRUNCATE') AS "currentTruncate",
        has_table_privilege('service_role', 'public.restore_suppression_runs', 'REFERENCES') AS "currentReferences",
        has_table_privilege('service_role', 'public.restore_suppression_runs', 'TRIGGER') AS "currentTrigger",
        has_function_privilege('service_role', 'public.protect_restore_suppression_run()', 'EXECUTE') AS "currentFunction",
        has_table_privilege('service_role', 'public.security_future_table', 'SELECT') AS "futureSelect",
        has_table_privilege('service_role', 'public.security_future_table', 'INSERT') AS "futureInsert",
        has_table_privilege('service_role', 'public.security_future_table', 'UPDATE') AS "futureUpdate",
        has_table_privilege('service_role', 'public.security_future_table', 'DELETE') AS "futureDelete",
        has_table_privilege('service_role', 'public.security_future_table', 'TRUNCATE') AS "futureTruncate",
        has_table_privilege('service_role', 'public.security_future_table', 'REFERENCES') AS "futureReferences",
        has_table_privilege('service_role', 'public.security_future_table', 'TRIGGER') AS "futureTrigger",
        has_sequence_privilege('service_role', 'public.security_future_sequence', 'USAGE,SELECT,UPDATE') AS "futureSequence",
        has_function_privilege('service_role', 'public.security_future_function()', 'EXECUTE') AS "futureFunction"`;
    assert.deepEqual(serviceAccess[0], {
      currentSelect: true,
      currentInsert: true,
      currentUpdate: true,
      currentDelete: false,
      currentTruncate: false,
      currentReferences: false,
      currentTrigger: false,
      currentFunction: true,
      futureSelect: true,
      futureInsert: true,
      futureUpdate: true,
      futureDelete: false,
      futureTruncate: false,
      futureReferences: false,
      futureTrigger: false,
      futureSequence: true,
      futureFunction: true,
    });

    await db.unsafe(`
      GRANT SELECT ON TABLE public.security_future_table TO PUBLIC;
      GRANT USAGE ON SEQUENCE public.security_future_sequence TO PUBLIC;
      GRANT EXECUTE ON FUNCTION public.security_future_function() TO PUBLIC;
    `);
    const publicExposure = await detectDenyAllViolations(db);
    assert.deepEqual(
      publicExposure.filter((finding) => finding.category === 'acl').map((finding) => [finding.objectType, finding.objectName, finding.grantee, finding.privilege]),
      [
        ['function', 'security_future_function()', 'PUBLIC', 'EXECUTE'],
        ['sequence', 'security_future_sequence', 'PUBLIC', 'USAGE'],
        ['table', 'security_future_table', 'PUBLIC', 'SELECT'],
      ],
      'ACL detector must reject intentional PUBLIC exposure',
    );
    console.log(JSON.stringify({ result: 'EXPECTED_DENY_ALL_VIOLATION_DETECTED', principal: 'PUBLIC', findings: 3 }));
    await db.unsafe(`
      REVOKE SELECT ON TABLE public.security_future_table FROM PUBLIC;
      REVOKE USAGE ON SEQUENCE public.security_future_sequence FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.security_future_function() FROM PUBLIC;
    `);
    await assertDenyAll(db, 'PUBLIC exposure must be removable');
    console.log(JSON.stringify({ result: 'DENY_ALL_RESTORED', principal: 'PUBLIC' }));

    await db.unsafe(`
      GRANT SELECT ON TABLE public.security_future_table TO anon;
      GRANT USAGE ON SEQUENCE public.security_future_sequence TO authenticated;
      GRANT EXECUTE ON FUNCTION public.security_future_function() TO anon;
    `);
    const dataApiExposure = await detectDenyAllViolations(db);
    assert.deepEqual(
      dataApiExposure.filter((finding) => finding.category === 'acl').map((finding) => [finding.objectType, finding.objectName, finding.grantee, finding.privilege]),
      [
        ['function', 'security_future_function()', 'anon', 'EXECUTE'],
        ['sequence', 'security_future_sequence', 'authenticated', 'USAGE'],
        ['table', 'security_future_table', 'anon', 'SELECT'],
      ],
      'ACL detector must reject intentional Data API role exposure',
    );
    console.log(JSON.stringify({ result: 'EXPECTED_DENY_ALL_VIOLATION_DETECTED', principal: 'DATA_API_ROLES', findings: 3 }));
    await db.unsafe(`
      REVOKE SELECT ON TABLE public.security_future_table FROM anon;
      REVOKE USAGE ON SEQUENCE public.security_future_sequence FROM authenticated;
      REVOKE EXECUTE ON FUNCTION public.security_future_function() FROM anon;
    `);
    await assertDenyAll(db, 'negative ACL fixtures must be fully cleaned');
    console.log(JSON.stringify({ result: 'DENY_ALL_RESTORED', principal: 'DATA_API_ROLES' }));
  } finally {
    await db.end();
  }
  console.log(JSON.stringify({ result: 'SUPABASE_DATA_API_DENY_ALL_VERIFIED', negativeAclTest: 'FAIL_THEN_PASS', ownerProfile: 'non-postgres' }));
} finally {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch(() => undefined);
  for (const role of [ownerName, ...[...roleNames].reverse()]) {
    if (createdRoles.has(role)) await admin.unsafe(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`).catch(() => undefined);
  }
  await admin.end();
}
