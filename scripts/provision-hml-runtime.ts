import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const runtimeRole = 'lead_finder_api_runtime';
const genericSql = await readFile(
  new URL('../database/security/create_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const hmlSql = await readFile(
  new URL('../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
);

const hmlFunctions = [
  'resolve_manual_email_contact_context',
  'create_manual_email_preparation',
  'resolve_manual_email_preparation_context',
  'append_manual_email_open_event',
  'get_manual_email_send_attempt',
  'create_manual_email_send_attempt',
  'append_manual_email_send_event',
] as const;

const restrictedTables = [
  'lead_contacts',
  'pilot_manual_message_preparations',
  'pilot_manual_message_events',
  'pilot_manual_email_send_attempts',
  'pilot_manual_email_send_events',
] as const;

const sql = postgres(databaseUrl, { max: 1 });

const verify = async () => {
  const role = (await sql<{
    login: boolean;
    inherit: boolean;
    superuser: boolean;
    createDb: boolean;
    createRole: boolean;
    replication: boolean;
    bypassRls: boolean;
  }[]>`
    select
      rolcanlogin as login,
      rolinherit as inherit,
      rolsuper as superuser,
      rolcreatedb as "createDb",
      rolcreaterole as "createRole",
      rolreplication as replication,
      rolbypassrls as "bypassRls"
    from pg_roles
    where rolname=${runtimeRole}
  `)[0];
  if (!role) throw new Error('RUNTIME_ROLE_MISSING_AFTER_PROVISION');
  if (role.superuser || role.createDb || role.createRole || role.replication || role.bypassRls || role.inherit) {
    throw new Error('RUNTIME_ROLE_ATTRIBUTES_NOT_LEAST_PRIVILEGE');
  }

  const functionRows = await sql<{ identity: string; executable: boolean }[]>`
    select procedure_record.oid::regprocedure::text as identity,
      has_function_privilege(${runtimeRole}, procedure_record.oid, 'EXECUTE') as executable
    from pg_proc procedure_record
    join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
    where namespace_record.nspname='public'
      and procedure_record.proname in ${sql(hmlFunctions)}
    order by identity
  `;
  const executable = functionRows.filter((row) => row.executable);
  if (executable.length !== hmlFunctions.length) {
    throw new Error(`HML_RUNTIME_FUNCTION_ALLOWLIST_INCOMPLETE:${executable.length}/${hmlFunctions.length}`);
  }

  const publicExecute = await sql<{ executable: boolean | null }[]>`
    select bool_or(privilege.privilege_type='EXECUTE') as executable
    from pg_proc procedure_record
    join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
    ) privilege
    where namespace_record.nspname='public'
      and procedure_record.proname in ${sql(hmlFunctions)}
      and privilege.grantee=0
  `;
  if (publicExecute[0]?.executable === true) throw new Error('HML_RUNTIME_PUBLIC_EXECUTE');

  const publicRoles = await sql<{ roleName: string; executable: boolean }[]>`
    select role_record.rolname as "roleName",
      exists (
        select 1
        from pg_proc procedure_record
        join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
        where namespace_record.nspname='public'
          and procedure_record.proname in ${sql(hmlFunctions)}
          and has_function_privilege(role_record.rolname, procedure_record.oid, 'EXECUTE')
      ) as executable
    from pg_roles role_record
    where role_record.rolname in ('anon','authenticated')
  `;
  if (publicRoles.some((row) => row.executable)) throw new Error('HML_RUNTIME_PUBLIC_ROLE_EXECUTE');

  const directTablePrivileges = await sql<{ name: string; privileged: boolean }[]>`
    select table_record.relname as name,
      (
        has_table_privilege(${runtimeRole}, table_record.oid, 'SELECT')
        or has_table_privilege(${runtimeRole}, table_record.oid, 'INSERT')
        or has_table_privilege(${runtimeRole}, table_record.oid, 'UPDATE')
        or has_table_privilege(${runtimeRole}, table_record.oid, 'DELETE')
        or has_table_privilege(${runtimeRole}, table_record.oid, 'TRUNCATE')
        or has_table_privilege(${runtimeRole}, table_record.oid, 'REFERENCES')
        or has_table_privilege(${runtimeRole}, table_record.oid, 'TRIGGER')
      ) as privileged
    from pg_class table_record
    join pg_namespace namespace_record on namespace_record.oid=table_record.relnamespace
    where namespace_record.nspname='public'
      and table_record.relname in ${sql(restrictedTables)}
  `;
  if (directTablePrivileges.some((row) => row.privileged)) {
    throw new Error('RUNTIME_ROLE_DIRECT_RESTRICTED_TABLE_ACCESS');
  }

  return {
    role: runtimeRole,
    hmlFunctions: executable.length,
    restrictedTablesWithoutDirectAccess: restrictedTables.length,
  };
};

try {
  // Each descriptor owns its transaction. If either stage fails, the process
  // exits non-zero and the caller must not continue deployment.
  await sql.unsafe(genericSql);
  await sql.unsafe(hmlSql);
  console.log(JSON.stringify({ result: 'HML_RUNTIME_PROVISIONED', ...(await verify()) }));
} finally {
  await sql.end();
}
