import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const owner = postgres(databaseUrl, { max: 1 });
const roleName = 'lead_finder_contact_resolver_runtime';
const stripPsqlMeta = (source: string) => source.replace(/^\\set ON_ERROR_STOP on\s*/m, '');
const createSql = stripPsqlMeta(await readFile(
  new URL('../database/security/create_lead_finder_contact_resolver_runtime.sql', import.meta.url),
  'utf8',
));
const rollbackSql = stripPsqlMeta(await readFile(
  new URL('../database/security/rollback_lead_finder_contact_resolver_runtime.sql', import.meta.url),
  'utf8',
));
const runAtomically = async (source: string) => {
  await owner.begin(async (transaction) => {
    await transaction.unsafe(source);
  });
};

try {
  await runAtomically(rollbackSql).catch(() => undefined);
  await runAtomically(createSql);
  await runAtomically(createSql);

  const attributes = (await owner<{
    login: boolean;
    inherit: boolean;
    superuser: boolean;
    createDb: boolean;
    createRole: boolean;
    replication: boolean;
    bypassRls: boolean;
    config: string[] | null;
  }[]>`
    SELECT
      rolcanlogin AS login,
      rolinherit AS inherit,
      rolsuper AS superuser,
      rolcreatedb AS "createDb",
      rolcreaterole AS "createRole",
      rolreplication AS replication,
      rolbypassrls AS "bypassRls",
      rolconfig AS config
    FROM pg_roles
    WHERE rolname=${roleName}`)[0];

  assert.ok(attributes);
  assert.equal(attributes.login, true);
  assert.equal(attributes.inherit, false);
  assert.equal(attributes.superuser, false);
  assert.equal(attributes.createDb, false);
  assert.equal(attributes.createRole, false);
  assert.equal(attributes.replication, false);
  assert.equal(attributes.bypassRls, false);
  assert.ok(attributes.config?.includes('search_path=pg_catalog, public'));
  assert.ok(attributes.config?.includes('statement_timeout=15s'));
  assert.ok(attributes.config?.includes('idle_in_transaction_session_timeout=15s'));

  const memberships = await owner<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid=membership.member
    WHERE member_role.rolname=${roleName}`;
  assert.equal(memberships[0]?.count, 0);

  const ownership = await owner<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_class object_record
    JOIN pg_roles owner_role ON owner_role.oid=object_record.relowner
    WHERE owner_role.rolname=${roleName}`;
  assert.equal(ownership[0]?.count, 0);

  const privileges = (await owner<{
    resolverExecute: boolean;
    contactsSelect: boolean;
    outboxSelect: boolean;
    localRegistryInsert: boolean;
    localRegistryUpdate: boolean;
    localRegistryDelete: boolean;
  }[]>`
    SELECT
      has_function_privilege(${roleName},
        'public.resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)','EXECUTE') AS "resolverExecute",
      has_table_privilege(${roleName},'public.lead_contacts','SELECT') AS "contactsSelect",
      has_table_privilege(${roleName},'public.campaign_outbox','SELECT') AS "outboxSelect",
      has_table_privilege(${roleName},'public.schema_migrations','INSERT') AS "localRegistryInsert",
      has_table_privilege(${roleName},'public.schema_migrations','UPDATE') AS "localRegistryUpdate",
      has_table_privilege(${roleName},'public.schema_migrations','DELETE') AS "localRegistryDelete"`)[0];

  assert.deepEqual(privileges, {
    resolverExecute: true,
    contactsSelect: false,
    outboxSelect: false,
    localRegistryInsert: false,
    localRegistryUpdate: false,
    localRegistryDelete: false,
  });

  const supabaseRegistryExists = (await owner<{ exists: boolean }[]>`
    SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists`)[0]?.exists;
  if (supabaseRegistryExists) {
    const registryWrites = (await owner<{
      insert: boolean;
      update: boolean;
      delete: boolean;
    }[]>`
      SELECT
        has_table_privilege(${roleName},'supabase_migrations.schema_migrations','INSERT') AS insert,
        has_table_privilege(${roleName},'supabase_migrations.schema_migrations','UPDATE') AS update,
        has_table_privilege(${roleName},'supabase_migrations.schema_migrations','DELETE') AS delete`)[0];
    assert.deepEqual(registryWrites, { insert: false, update: false, delete: false });
  }

  await assert.rejects(owner.begin(async (transaction) => {
    await transaction.unsafe(`SET LOCAL ROLE ${roleName}`);
    await transaction.unsafe('CREATE TABLE public.resolver_role_escape(id integer)');
  }));

  await runAtomically(rollbackSql);
  await runAtomically(rollbackSql);
  const remaining = await owner<{ count: number }[]>`
    SELECT count(*)::int AS count FROM pg_roles WHERE rolname=${roleName}`;
  assert.equal(remaining[0]?.count, 0);

  console.log(JSON.stringify({
    result: 'CONTACT_RESOLVER_ROLE_REPLAY_PASS',
    createReplay: 2,
    rollbackReplay: 2,
    memberships: 0,
    ownership: 0,
    registryWrites: 'DENIED',
    ddl: 'DENIED',
  }));
} finally {
  await runAtomically(rollbackSql).catch(() => undefined);
  await owner.end();
}
