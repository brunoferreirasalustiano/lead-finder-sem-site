import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required');

const roleName = 'lead_finder_api_runtime';
const rolePassword = 'synthetic-hml-email-readonly-role-password-0001';
const owner = postgres(sourceUrl, { max: 1 });
const createSql = await readFile(
  new URL('../database/security/create_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const hmlSupplementSql = await readFile(
  new URL('../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
);
const rollbackSql = await readFile(
  new URL('../database/security/rollback_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

let restricted: ReturnType<typeof postgres> | undefined;
try {
  await owner.unsafe(rollbackSql).catch(() => undefined);
  await owner.unsafe(createSql);
  await owner.unsafe(hmlSupplementSql);
  await owner.unsafe(hmlSupplementSql);
  await owner.unsafe(`ALTER ROLE ${roleName} PASSWORD ${quoteLiteral(rolePassword)}`);

  const privileges = await owner<{
    name: string;
    canSelect: boolean;
    canInsert: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    canTruncate: boolean;
    canReferences: boolean;
    canTrigger: boolean;
  }[]>`
    select
      c.relname as name,
      has_table_privilege(${roleName}, c.oid, 'SELECT') as "canSelect",
      has_table_privilege(${roleName}, c.oid, 'INSERT') as "canInsert",
      has_table_privilege(${roleName}, c.oid, 'UPDATE') as "canUpdate",
      has_table_privilege(${roleName}, c.oid, 'DELETE') as "canDelete",
      has_table_privilege(${roleName}, c.oid, 'TRUNCATE') as "canTruncate",
      has_table_privilege(${roleName}, c.oid, 'REFERENCES') as "canReferences",
      has_table_privilege(${roleName}, c.oid, 'TRIGGER') as "canTrigger"
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in ('operator_email_test_attempts','operator_email_test_events')
    order by c.relname`;

  assert.equal(privileges.length, 2);
  for (const row of privileges) {
    assert.equal(row.canSelect, true, `${row.name} must allow SELECT in HML`);
    assert.equal(row.canInsert, false, `${row.name} must deny direct INSERT`);
    assert.equal(row.canUpdate, false, `${row.name} must deny UPDATE`);
    assert.equal(row.canDelete, false, `${row.name} must deny DELETE`);
    assert.equal(row.canTruncate, false, `${row.name} must deny TRUNCATE`);
    assert.equal(row.canReferences, false, `${row.name} must deny REFERENCES`);
    assert.equal(row.canTrigger, false, `${row.name} must deny TRIGGER`);
  }

  const policies = await owner<{
    tableName: string;
    policyName: string;
    command: string;
  }[]>`
    select tablename as "tableName", policyname as "policyName", cmd as command
    from pg_policies
    where schemaname='public'
      and roles=ARRAY[${roleName}]::name[]
      and tablename in ('operator_email_test_attempts','operator_email_test_events')
    order by tablename,policyname`;
  assert.deepEqual(policies, [
    {
      tableName: 'operator_email_test_attempts',
      policyName: 'lead_finder_api_runtime_operator_email_attempts_select',
      command: 'SELECT',
    },
    {
      tableName: 'operator_email_test_events',
      policyName: 'lead_finder_api_runtime_operator_email_events_select',
      command: 'SELECT',
    },
  ]);

  const roleUrl = new URL(sourceUrl);
  roleUrl.username = roleName;
  roleUrl.password = rolePassword;
  restricted = postgres(roleUrl.toString(), { max: 1 });

  await restricted`select id from public.operator_email_test_attempts limit 1`;
  await restricted`select id from public.operator_email_test_events limit 1`;

  const insertDenied = async (table: string) => {
    try {
      await restricted!.unsafe(`insert into public.${table} default values`);
      assert.fail(`${table} direct INSERT must fail`);
    } catch (error) {
      const candidate = error as { code?: unknown };
      assert.equal(candidate.code, '42501');
    }
  };
  await insertDenied('operator_email_test_attempts');
  await insertDenied('operator_email_test_events');

  console.log(JSON.stringify({
    result: 'HML_OPERATOR_EMAIL_RUNTIME_GRANTS_PASS',
    tables: 2,
    select: 'ALLOWED',
    directWrites: 'DENIED',
    rlsPolicies: 2,
    realRecipients: 0,
    messagesSent: 0,
  }));
} finally {
  if (restricted) await restricted.end().catch(() => undefined);
  await owner.unsafe(rollbackSql).catch(() => undefined);
  await owner.end();
}
