import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres from 'postgres';

const execFileAsync = promisify(execFile);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const roleName = 'lead_finder_api_runtime';
const rolePassword = 'synthetic-runtime-grants-role-password-0001';
const migrationVersions = [
  '0042_restricted_manual_email_consumer',
  '0043_restricted_manual_email_hardening',
  '0044_manual_email_historical_snapshot_compatibility',
  '0045_restricted_manual_email_review_followups',
  '0046_restricted_manual_email_open_order',
  '0047_restricted_manual_email_final_review',
] as const;
const hmlFunctions = [
  'resolve_manual_email_contact_context',
  'create_manual_email_preparation',
  'resolve_manual_email_preparation_context',
  'append_manual_email_open_event',
  'get_manual_email_send_attempt',
  'create_manual_email_send_attempt',
  'append_manual_email_send_event',
  'run_hml_suppression_probe',
] as const;
const restrictedTables = [
  'lead_contacts',
  'pilot_manual_message_preparations',
  'pilot_manual_message_events',
  'pilot_manual_email_send_attempts',
  'pilot_manual_email_send_events',
] as const;

const owner = postgres(databaseUrl, { max: 2 });
const roleUrl = new URL(databaseUrl);
roleUrl.username = roleName;
roleUrl.password = rolePassword;

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const runProvision = async () => {
  await execFileAsync(npmCommand, ['run', 'db:provision:hml-runtime'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    maxBuffer: 1024 * 1024,
  });
};

const functionPrivileges = () => owner<{ identity: string; executable: boolean }[]>`
  select procedure_record.oid::regprocedure::text as identity,
    has_function_privilege(${roleName}, procedure_record.oid, 'EXECUTE') as executable
  from pg_proc procedure_record
  join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
  where namespace_record.nspname='public'
    and procedure_record.proname in ${owner(hmlFunctions)}
  order by identity`;

const assertRestrictedTablesDenied = async () => {
  const rows = await owner<{ name: string; privileged: boolean }[]>`
    select table_record.relname as name,
      (
        has_table_privilege(${roleName}, table_record.oid, 'SELECT')
        or has_table_privilege(${roleName}, table_record.oid, 'INSERT')
        or has_table_privilege(${roleName}, table_record.oid, 'UPDATE')
        or has_table_privilege(${roleName}, table_record.oid, 'DELETE')
        or has_table_privilege(${roleName}, table_record.oid, 'TRUNCATE')
        or has_table_privilege(${roleName}, table_record.oid, 'REFERENCES')
        or has_table_privilege(${roleName}, table_record.oid, 'TRIGGER')
      ) as privileged
    from pg_class table_record
    join pg_namespace namespace_record on namespace_record.oid=table_record.relnamespace
    where namespace_record.nspname='public'
      and table_record.relname in ${owner(restrictedTables)}`;
  assert.equal(rows.length, restrictedTables.length);
  assert.equal(rows.some((row) => row.privileged), false);
};

try {
  const applied = await owner<{ version: string }[]>`
    select version from public.schema_migrations
    where version in ${owner(migrationVersions)}`;
  assert.equal(applied.length, migrationVersions.length, '0042-0047 must be applied first');

  await owner.unsafe(
    `ALTER ROLE ${roleName} PASSWORD '${rolePassword.replaceAll("'", "''")}'`,
  );

  const before = await functionPrivileges();
  assert.equal(before.length, hmlFunctions.length);
  assert.equal(before.some((row) => row.executable), false, 'pre-fix state must reproduce SQLSTATE 42501');
  await assertRestrictedTablesDenied();

  const deniedRole = postgres(roleUrl.toString(), { max: 1 });
  await assert.rejects(
    deniedRole`select public.resolve_manual_email_contact_context(NULL::uuid,NULL::uuid,NULL::uuid,'runtime-grants-test')`,
    (error: unknown) => (error as { code?: unknown }).code === '42501',
  );
  await deniedRole.end();

  await runProvision();
  await runProvision();

  const after = await functionPrivileges();
  assert.equal(after.length, hmlFunctions.length);
  assert.equal(after.every((row) => row.executable), true);
  await assertRestrictedTablesDenied();

  const publicExecute = await owner<{ executable: boolean | null }[]>`
    select bool_or(privilege.privilege_type='EXECUTE') as executable
    from pg_proc procedure_record
    join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
    ) privilege
    where namespace_record.nspname='public'
      and procedure_record.proname in ${owner(hmlFunctions)}
      and privilege.grantee=0`;
  assert.equal(publicExecute[0]?.executable === true, false);

  const forbidden = await owner<{ executable: boolean }[]>`
    select has_function_privilege(${roleName}, 'public.resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)'::regprocedure, 'EXECUTE') as executable`;
  assert.equal(forbidden[0]?.executable, false);

  const principals = await owner<{ rolname: string }[]>`
    select rolname from pg_roles where rolname in ('anon','authenticated')`;
  for (const principal of principals) {
    const denied = await owner<{ executable: boolean }[]>`
      select not exists (
        select 1
        from pg_proc procedure_record
        join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
        where namespace_record.nspname='public'
          and procedure_record.proname in ${owner(hmlFunctions)}
          and has_function_privilege(${principal.rolname}, procedure_record.oid, 'EXECUTE')
      ) as executable`;
    assert.equal(denied[0]?.executable, true);
  }

  console.log(JSON.stringify({
    result: 'RUNTIME_GRANTS_AFTER_MIGRATIONS_PASS',
    preFix: '42501',
    postFixFunctions: after.length,
    replay: 2,
    restrictedTablesDenied: true,
  }));
} finally {
  await owner.end();
}
