import postgres from 'postgres';
import {
  buildMigrationRegistry,
  type MigrationRegistry,
  type MigrationSource,
  type SupabaseMigrationRow,
} from './migration-registry-plan.js';

type Sql = ReturnType<typeof postgres>;

type CountRow = { count: number };
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

const manualMessagingTables = [
  'contact_channel_authorizations',
  'contact_email_business_evidence',
  'pilot_manual_message_preparations',
  'pilot_manual_message_events',
] as const;

const manualMessagingTriggers = [
  'contact_channel_authorizations_append_only',
  'contact_email_business_evidence_append_only',
  'pilot_manual_message_preparations_append_only',
  'pilot_manual_message_events_append_only',
  'contact_email_business_evidence_validate',
  'pilot_manual_message_transition_guard',
  'campaign_opt_outs_manual_messaging_lock',
] as const;

export async function assertNarrowContactResolutionObjects(sql: Sql): Promise<void> {
  const rows = await sql<{
    functionExists: boolean;
    revocationTableExists: boolean;
    rowLevelSecurityEnabled: boolean;
    appendOnlyTriggerValid: boolean;
  }[]>`
    SELECT
      to_regprocedure('public.resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)') IS NOT NULL
        AS "functionExists",
      to_regclass('public.contact_channel_authorization_revocations') IS NOT NULL
        AS "revocationTableExists",
      coalesce((
        SELECT table_record.relrowsecurity
        FROM pg_class table_record
        JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
        WHERE namespace_record.nspname = 'public'
          AND table_record.relname = 'contact_channel_authorization_revocations'
          AND table_record.relkind = 'r'
      ), false) AS "rowLevelSecurityEnabled",
      EXISTS (
        SELECT 1
        FROM pg_trigger trigger_record
        JOIN pg_class table_record ON table_record.oid = trigger_record.tgrelid
        JOIN pg_namespace table_namespace ON table_namespace.oid = table_record.relnamespace
        JOIN pg_proc procedure_record ON procedure_record.oid = trigger_record.tgfoid
        JOIN pg_namespace procedure_namespace ON procedure_namespace.oid = procedure_record.pronamespace
        WHERE table_namespace.nspname = 'public'
          AND table_record.relname = 'contact_channel_authorization_revocations'
          AND trigger_record.tgname = 'contact_channel_authorization_revocations_append_only'
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgenabled <> 'D'
          AND trigger_record.tgtype = 27
          AND procedure_namespace.nspname = 'public'
          AND procedure_record.proname = 'reject_manual_messaging_history_mutation'
      ) AS "appendOnlyTriggerValid"`;
  if (
    !rows[0]?.functionExists ||
    !rows[0].revocationTableExists ||
    !rows[0].rowLevelSecurityEnabled ||
    !rows[0].appendOnlyTriggerValid
  ) {
    throw new Error('migration 0025 is missing narrow contact resolution objects');
  }

  const exposed = await sql<CountRow[]>`
    SELECT count(*)::int AS count
    FROM pg_class table_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(
      table_record.relacl,
      acldefault('r', table_record.relowner)
    )) privilege_record
    LEFT JOIN pg_roles role_record ON role_record.oid = privilege_record.grantee
    WHERE namespace_record.nspname = 'public'
      AND table_record.relname = 'contact_channel_authorization_revocations'
      AND table_record.relkind = 'r'
      AND (
        privilege_record.grantee = 0
        OR role_record.rolname IN ('anon', 'authenticated')
      )`;
  if (exposed[0]?.count !== 0) {
    throw new Error('migration 0025 exposes contact authorization revocations');
  }

  const serviceRole = await sql<CountRow[]>`
    SELECT count(*)::int AS count FROM pg_roles WHERE rolname = 'service_role'`;
  if (serviceRole[0]?.count === 1) {
    const access = (await sql<AccessRow[]>`
      SELECT
        table_record.relname AS "tableName",
        has_table_privilege('service_role', table_record.oid, 'SELECT') AS "canSelect",
        has_table_privilege('service_role', table_record.oid, 'INSERT') AS "canInsert",
        has_table_privilege('service_role', table_record.oid, 'UPDATE') AS "canUpdate",
        has_table_privilege('service_role', table_record.oid, 'DELETE') AS "canDelete",
        has_table_privilege('service_role', table_record.oid, 'TRUNCATE') AS "canTruncate",
        has_table_privilege('service_role', table_record.oid, 'REFERENCES') AS "canReferences",
        has_table_privilege('service_role', table_record.oid, 'TRIGGER') AS "canTrigger"
      FROM pg_class table_record
      JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
      WHERE namespace_record.nspname = 'public'
        AND table_record.relname = 'contact_channel_authorization_revocations'
        AND table_record.relkind = 'r'`)[0];
    if (
      !access?.canSelect ||
      !access.canInsert ||
      access.canUpdate ||
      access.canDelete ||
      access.canTruncate ||
      access.canReferences ||
      access.canTrigger
    ) {
      throw new Error('migration 0025 has incompatible service_role revocation ACL');
    }
  }
}

export async function loadMigrationRegistry(sql: Sql): Promise<MigrationRegistry> {
  const localRows = await sql<{ version: string }[]>`
    SELECT version
    FROM public.schema_migrations
    ORDER BY version`;

  const registryTable = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists`;

  let supabaseRows: SupabaseMigrationRow[] = [];
  if (registryTable[0]?.exists) {
    supabaseRows = await sql<SupabaseMigrationRow[]>`
      SELECT version::text AS version, name::text AS name
      FROM supabase_migrations.schema_migrations
      ORDER BY version`;
  }

  return buildMigrationRegistry(
    localRows.map((row) => row.version),
    supabaseRows,
  );
}

async function assertManualMessagingObjects(sql: Sql): Promise<void> {
  const tables = await sql<CountRow[]>`
    SELECT count(*)::int AS count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN ${sql(manualMessagingTables)}`;
  if (tables[0]?.count !== manualMessagingTables.length) {
    throw new Error('imported migration 0019 is missing manual messaging tables');
  }

  const rls = await sql<CountRow[]>`
    SELECT count(*)::int AS count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND c.relname IN ${sql(manualMessagingTables)}`;
  if (rls[0]?.count !== manualMessagingTables.length) {
    throw new Error('imported migration 0019 is missing row-level security');
  }

  const triggers = await sql<CountRow[]>`
    SELECT count(DISTINCT t.tgname)::int AS count
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname IN ${sql(manualMessagingTriggers)}`;
  if (triggers[0]?.count !== manualMessagingTriggers.length) {
    throw new Error('imported migration 0019 is missing required triggers');
  }

  const foreignKeys = await sql<CountRow[]>`
    SELECT count(*)::int AS count
    FROM pg_constraint constraint_record
    JOIN pg_class c ON c.oid = constraint_record.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND constraint_record.contype = 'f'
      AND c.relname IN ${sql(manualMessagingTables)}`;
  if ((foreignKeys[0]?.count ?? 0) < 5) {
    throw new Error('imported migration 0019 is missing required foreign keys');
  }
}

async function assertManualMessagingAcl(sql: Sql): Promise<void> {
  await assertManualMessagingObjects(sql);

  const role = await sql<CountRow[]>`
    SELECT count(*)::int AS count
    FROM pg_roles
    WHERE rolname = 'service_role'`;
  if (role[0]?.count !== 1) {
    throw new Error('imported migration 0020 requires service_role');
  }

  const access = await sql<AccessRow[]>`
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
      AND c.relname IN ${sql(manualMessagingTables)}
    ORDER BY c.relname`;

  if (access.length !== manualMessagingTables.length) {
    throw new Error('imported migration 0020 is missing target tables');
  }
  for (const row of access) {
    if (
      !row.canSelect ||
      !row.canInsert ||
      row.canUpdate ||
      row.canDelete ||
      row.canTruncate ||
      row.canReferences ||
      row.canTrigger
    ) {
      throw new Error(`imported migration 0020 has incompatible service_role ACL on ${row.tableName}`);
    }
  }

  const exposed = await sql<CountRow[]>`
    WITH targets AS (
      SELECT c.oid, c.relacl, c.relowner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN ${sql(manualMessagingTables)}
    )
    SELECT count(*)::int AS count
    FROM targets target
    CROSS JOIN LATERAL aclexplode(coalesce(target.relacl, acldefault('r', target.relowner))) acl
    LEFT JOIN pg_roles role_record ON role_record.oid = acl.grantee
    WHERE acl.grantee = 0 OR role_record.rolname IN ('anon', 'authenticated')`;
  if (exposed[0]?.count !== 0) {
    throw new Error('imported migration 0020 exposes manual messaging tables');
  }
}

export async function assertImportedMigrationParity(
  sql: Sql,
  migrationName: string,
  source: MigrationSource,
): Promise<void> {
  if (source !== 'SUPABASE' && source !== 'BOTH') return;

  if (migrationName === '0019_manual_assisted_messaging') {
    await assertManualMessagingObjects(sql);
    return;
  }
  if (migrationName === '0020_manual_messaging_append_only_acl') {
    await assertManualMessagingAcl(sql);
    return;
  }

  if (source === 'SUPABASE') {
    throw new Error(`Supabase-only migration ${migrationName} has no parity validator`);
  }
}
