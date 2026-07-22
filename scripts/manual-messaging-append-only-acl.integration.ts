import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';

const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required');

const suffix = `${process.pid}_${Date.now()}`;
const databaseName = `manual_messaging_acl_${suffix}`;
const ownerName = `manual_messaging_acl_owner_${suffix}`;
const ownerPassword = `synthetic-owner-${suffix}`;
const requiredRoles = ['anon', 'authenticated', 'service_role'] as const;
const createdRoles = new Set<string>();
const targetTables = [
  'contact_channel_authorizations',
  'contact_email_business_evidence',
  'pilot_manual_message_preparations',
  'pilot_manual_message_events',
] as const;

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const admin = postgres(sourceUrl, { max: 1 });
const fixtureUrl = new URL(sourceUrl);
fixtureUrl.pathname = `/${databaseName}`;
fixtureUrl.username = ownerName;
fixtureUrl.password = ownerPassword;

async function applyMigrationsTwice(url: string): Promise<void> {
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
  } finally {
    await db.end();
  }
}

type AccessRow = {
  tableName: string;
  canSelect: boolean;
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canTruncate: boolean;
  canReferences: boolean;
  canTrigger: boolean;
};

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
  await applyMigrationsTwice(fixtureUrl.toString());

  const db = postgres(fixtureUrl.toString(), { max: 1 });
  try {
    const tableList = targetTables.map((name) => `public.${name}`).join(', ');
    await db.unsafe(`GRANT UPDATE ON TABLE ${tableList} TO service_role`);

    const reconciliation = await readFile(
      new URL('../database/migrations/0020_manual_messaging_append_only_acl.sql', import.meta.url),
      'utf8',
    );
    await db.unsafe(reconciliation);
    await db.unsafe(reconciliation);

    const access = await db<AccessRow[]>`
      SELECT
        c.relname AS "tableName",
        has_table_privilege('service_role', c.oid, 'SELECT') AS "canSelect",
        has_table_privilege('service_role', c.oid, 'INSERT') AS "canInsert",
        has_table_privilege('service_role', c.oid, 'UPDATE') AS "canUpdate",
        has_table_privilege('service_role', c.oid, 'DELETE') AS "canDelete",
        has_table_privilege('service_role', c.oid, 'TRUNCATE') AS "canTruncate",
        has_table_privilege('service_role', c.oid, 'REFERENCES') AS "canReferences",
        has_table_privilege('service_role', c.oid, 'TRIGGER') AS "canTrigger"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN ${db(targetTables)}
      ORDER BY c.relname`;

    assert.equal(access.length, targetTables.length);
    for (const row of access) {
      assert.deepEqual(row, {
        tableName: row.tableName,
        canSelect: true,
        canInsert: true,
        canUpdate: false,
        canDelete: false,
        canTruncate: false,
        canReferences: false,
        canTrigger: false,
      });
    }

    const exposed = await db<{ count: number }[]>`
      WITH targets AS (
        SELECT c.oid, c.relacl, c.relowner
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname IN ${db(targetTables)}
      )
      SELECT count(*)::int AS count
      FROM targets t
      CROSS JOIN LATERAL aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) acl
      LEFT JOIN pg_roles r ON r.oid = acl.grantee
      WHERE acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated')`;
    assert.equal(exposed[0]?.count, 0);

    console.log(JSON.stringify({
      result: 'MANUAL_MESSAGING_APPEND_ONLY_ACL_PASS',
      tables: targetTables.length,
      replay: 2,
      publicOrDataApiGrants: 0,
    }));
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
