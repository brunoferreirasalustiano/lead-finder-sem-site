import { mkdir, readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const roleName = 'lead_finder_api_runtime';
const db = postgres(databaseUrl, { max: 1 });
const createSql = await readFile(new URL('../database/security/create_lead_finder_api_runtime.sql', import.meta.url), 'utf8');
const rollbackSql = await readFile(new URL('../database/security/rollback_lead_finder_api_runtime.sql', import.meta.url), 'utf8');

try {
  await db.unsafe(rollbackSql).catch(() => undefined);
  await db.unsafe(createSql);
  const rows = await db<{
    name: string;
    canSelect: boolean;
    canInsert: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    canTruncate: boolean;
    canReferences: boolean;
    canTrigger: boolean;
  }[]>`
    SELECT
      table_record.relname AS name,
      has_table_privilege(${roleName}, table_record.oid, 'SELECT') AS "canSelect",
      has_table_privilege(${roleName}, table_record.oid, 'INSERT') AS "canInsert",
      has_table_privilege(${roleName}, table_record.oid, 'UPDATE') AS "canUpdate",
      has_table_privilege(${roleName}, table_record.oid, 'DELETE') AS "canDelete",
      has_table_privilege(${roleName}, table_record.oid, 'TRUNCATE') AS "canTruncate",
      has_table_privilege(${roleName}, table_record.oid, 'REFERENCES') AS "canReferences",
      has_table_privilege(${roleName}, table_record.oid, 'TRIGGER') AS "canTrigger"
    FROM pg_class table_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
    WHERE namespace_record.nspname = 'public'
      AND table_record.relkind IN ('r', 'p')
      AND (
        has_table_privilege(${roleName}, table_record.oid, 'SELECT')
        OR has_table_privilege(${roleName}, table_record.oid, 'INSERT')
        OR has_table_privilege(${roleName}, table_record.oid, 'UPDATE')
        OR has_table_privilege(${roleName}, table_record.oid, 'DELETE')
        OR has_table_privilege(${roleName}, table_record.oid, 'TRUNCATE')
        OR has_table_privilege(${roleName}, table_record.oid, 'REFERENCES')
        OR has_table_privilege(${roleName}, table_record.oid, 'TRIGGER')
      )
    ORDER BY table_record.relname`;
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/pilot-readiness.json', import.meta.url), JSON.stringify({
    evidenceType: 'RUNTIME_ROLE_TABLE_ACL_DIAGNOSTIC',
    result: 'DIAGNOSTIC_ONLY',
    rows,
  }, null, 2));
} finally {
  await db.unsafe(rollbackSql).catch(() => undefined);
  await db.end();
}

throw new Error('RUNTIME_ROLE_TABLE_ACL_DIAGNOSTIC_COMPLETE');
