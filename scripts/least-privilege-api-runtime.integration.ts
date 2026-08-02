import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import {
  checkExpectedMigration,
  confirmOperatorTestResult,
  createDatabase,
  getReadiness,
  prepareOperatorWhatsAppTest,
  recordOperatorTestOpen,
  recordOperatorTestResponse,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';

const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required');

const roleName = 'lead_finder_api_runtime';
const rolePassword = 'synthetic-runtime-role-password-0001';
const owner = postgres(sourceUrl, { max: 1 });
const createSql = await readFile(
  new URL('../database/security/create_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const executeGrantMigration = await readFile(
  new URL('../database/migrations/0034_runtime_security_definer_execute_grants.sql', import.meta.url),
  'utf8',
);
const rollbackSql = await readFile(
  new URL('../database/security/rollback_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
const evidencePath = new URL('../artifacts/pilot-readiness.json', import.meta.url);
const writeFailureEvidence = async (stage: string, error: unknown) => {
  const candidate = error as { name?: unknown; code?: unknown };
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({
    evidenceType: 'RUNTIME_ROLE_FAILURE',
    result: 'FAIL',
    stage,
    errorName: typeof candidate?.name === 'string' ? candidate.name : 'UNKNOWN',
    errorCode: typeof candidate?.code === 'string' ? candidate.code : 'UNKNOWN',
  }, null, 2));
};

const roleUrl = new URL(sourceUrl);
roleUrl.username = roleName;
roleUrl.password = rolePassword;
const auth = createAuthorizationContext({
  principalId: 'least-privilege-operator-test',
  permissions: new Set([
    'operator-test:prepare',
    'operator-test:open',
    'operator-test:confirm',
    'operator-test:response',
  ]),
  authenticationMethod: 'integration-test',
});
const runtime = {
  enabled: true,
  killSwitchEnabled: false,
  authorizedPhoneE164: '+12025550100',
  fingerprintKey: 'least-privilege-runtime-hmac-key-0001',
} as const;
const input = () => ({
  templateId: 'operator-whatsapp-channel-test',
  templateVersion: 'v1',
  idempotencyKey: randomUUID(),
});

let restrictedRaw: ReturnType<typeof postgres> | undefined;
let closeRestricted: (() => Promise<void>) | undefined;
let stage = 'INITIALIZE';

try {
  stage = 'PRECREATE_ROLLBACK';
  await owner.unsafe(rollbackSql).catch(() => undefined);
  stage = 'CREATE_ROLE_FIRST_PASS';
  await owner.unsafe(createSql);
  stage = 'CREATE_ROLE_REPLAY';
  await owner.unsafe(createSql);
  stage = 'SET_SYNTHETIC_PASSWORD';
  await owner.unsafe(`ALTER ROLE ${roleName} PASSWORD ${quoteLiteral(rolePassword)}`);

  stage = 'REVOKE_FUNCTION_GRANTS_FOR_MIGRATION_REPLAY';
  await owner.unsafe(`
    REVOKE EXECUTE ON FUNCTION
      public.create_operator_channel_test_preparation(char, char, char, char, char, char),
      public.append_operator_channel_test_event(uuid, text, text, char, char, char),
      public.create_operator_email_test_attempt(char, char, char, char, char, char),
      public.append_operator_email_test_event(uuid, text, char, char, char)
    FROM ${roleName}`);
  stage = 'APPLY_0034_RUNTIME_EXECUTE_GRANTS';
  await owner.unsafe(executeGrantMigration);

  stage = 'VERIFY_ATTRIBUTES';
  const attributes = (
    await owner<{
      login: boolean;
      inherit: boolean;
      superuser: boolean;
      createDb: boolean;
      createRole: boolean;
      replication: boolean;
      bypassRls: boolean;
    }[]>`
      SELECT
        rolcanlogin AS login,
        rolinherit AS inherit,
        rolsuper AS superuser,
        rolcreatedb AS "createDb",
        rolcreaterole AS "createRole",
        rolreplication AS replication,
        rolbypassrls AS "bypassRls"
      FROM pg_roles
      WHERE rolname = ${roleName}`
  )[0];
  assert.ok(attributes);
  assert.equal(attributes.login, true);
  assert.equal(attributes.inherit, false);
  assert.equal(attributes.superuser, false);
  assert.equal(attributes.createDb, false);
  assert.equal(attributes.createRole, false);
  assert.equal(attributes.replication, false);
  assert.equal(attributes.bypassRls, false);

  const memberships = await owner<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    WHERE member_role.rolname = ${roleName}`;
  assert.equal(memberships[0]?.count, 0);

  stage = 'VERIFY_TABLE_ACL';
  const tablePrivileges = await owner<{
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
  assert.equal(tablePrivileges.length, 3);
  assert.deepEqual(tablePrivileges.map((row) => row.name), [
    'operator_channel_test_events',
    'operator_channel_test_preparations',
    'schema_migrations',
  ]);
  for (const privilege of tablePrivileges) {
    assert.equal(privilege.canSelect, true, `${privilege.name} must be selectable`);
    assert.equal(privilege.canInsert, false, `${privilege.name} must reject INSERT`);
    assert.equal(privilege.canUpdate, false, `${privilege.name} must reject UPDATE`);
    assert.equal(privilege.canDelete, false, `${privilege.name} must reject DELETE`);
    assert.equal(privilege.canTruncate, false, `${privilege.name} must reject TRUNCATE`);
    assert.equal(privilege.canReferences, false, `${privilege.name} must reject REFERENCES`);
    assert.equal(privilege.canTrigger, false, `${privilege.name} must reject TRIGGER`);
  }

  stage = 'VERIFY_FUNCTION_ACL';
  const executableFunctions = await owner<{ identity: string }[]>`
    SELECT procedure_record.oid::regprocedure::text AS identity
    FROM pg_proc procedure_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = procedure_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND has_function_privilege(${roleName}, procedure_record.oid, 'EXECUTE')
    ORDER BY identity`;
  assert.deepEqual(executableFunctions.map(({ identity }) => identity), [
    'append_operator_channel_test_event(uuid,text,text,character,character,character)',
    'append_operator_email_test_event(uuid,text,character,character,character)',
    'create_operator_channel_test_preparation(character,character,character,character,character,character)',
    'create_operator_email_test_attempt(character,character,character,character,character,character)',
  ]);
  const publicExecutableFunctions = await owner<{ identity: string }[]>`
    SELECT procedure_record.oid::regprocedure::text AS identity
    FROM pg_proc procedure_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = procedure_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND procedure_record.proname IN (
        'append_operator_channel_test_event',
        'append_operator_email_test_event',
        'create_operator_channel_test_preparation',
        'create_operator_email_test_attempt'
      )
      AND has_function_privilege('public', procedure_record.oid, 'EXECUTE')
    ORDER BY identity`;
  assert.deepEqual(publicExecutableFunctions, []);

  stage = 'VERIFY_RLS_POLICIES';
  const policies = await owner<{ policyname: string }[]>`
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles = ARRAY[${roleName}]::name[]
    ORDER BY policyname`;
  assert.deepEqual(policies.map(({ policyname }) => policyname), [
    'lead_finder_api_runtime_operator_events_select',
    'lead_finder_api_runtime_operator_preparations_select',
    'lead_finder_api_runtime_schema_migrations_select',
  ]);

  stage = 'CONNECT_RESTRICTED_ROLE';
  restrictedRaw = postgres(roleUrl.toString(), { max: 1 });
  const restrictedDatabase = createDatabase(roleUrl.toString(), { max: 4 });
  closeRestricted = restrictedDatabase.close;

  assert.equal((await restrictedRaw<{ currentUser: string }[]>`
    SELECT current_user AS "currentUser"`)[0]?.currentUser, roleName);
  assert.equal((await restrictedRaw<{ canCreate: boolean }[]>`
    SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS "canCreate"`)[0]?.canCreate, false);

  stage = 'VERIFY_RESTRICTED_READINESS';
  await checkExpectedMigration(restrictedDatabase.db);
  const readiness = await getReadiness(restrictedDatabase.db, {
    backlogCount: 1,
    oldestPendingAgeMs: 1,
  });
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.mode, 'restricted');
  assert.equal(readiness.snapshot, null);

  stage = 'VERIFY_OPERATOR_FLOW';
  const preparation = await prepareOperatorWhatsAppTest(
    restrictedDatabase.db,
    input(),
    auth,
    runtime,
  );
  assert.equal(preparation.state, 'PREPARED');
  const opened = await recordOperatorTestOpen(
    restrictedDatabase.db,
    preparation.preparationId,
    { idempotencyKey: randomUUID() },
    auth,
    runtime,
  );
  assert.equal(opened.state, 'OPENED');
  const confirmed = await confirmOperatorTestResult(
    restrictedDatabase.db,
    preparation.preparationId,
    { result: 'SENT_CONFIRMED', idempotencyKey: randomUUID() },
    auth,
    runtime,
  );
  assert.equal(confirmed.state, 'CONTACT_CONFIRMED');
  const response = await recordOperatorTestResponse(
    restrictedDatabase.db,
    preparation.preparationId,
    { result: 'NOT_RECEIVED', idempotencyKey: randomUUID() },
    auth,
    runtime,
  );
  assert.equal(response.state, 'RESPONSE_RECORDED');

  stage = 'VERIFY_EMAIL_FUNCTION_FLOW';
  const emailAttempt = (await restrictedRaw`
    SELECT * FROM public.create_operator_email_test_attempt(
      ${'a'.repeat(64)}::char(64), ${'b'.repeat(64)}::char(64), ${'c'.repeat(64)}::char(64),
      ${'d'.repeat(64)}::char(64), ${'e'.repeat(64)}::char(64), ${'f'.repeat(64)}::char(64)
    )`)[0];
  assert.ok(emailAttempt?.id);
  const emailEvent = (await restrictedRaw`
    SELECT * FROM public.append_operator_email_test_event(
      ${emailAttempt.id}::uuid, 'FAILED', ${'c'.repeat(64)}::char(64),
      ${'d'.repeat(64)}::char(64), ${'e'.repeat(64)}::char(64)
    )`)[0];
  assert.ok(emailEvent?.id);
  await assert.rejects(restrictedRaw`
    SELECT * FROM public.create_operator_email_test_attempt(
      ${'x'.repeat(64)}::char(64), ${'b'.repeat(64)}::char(64), ${'c'.repeat(64)}::char(64),
      ${'d'.repeat(64)}::char(64), ${'e'.repeat(64)}::char(64), ${'f'.repeat(64)}::char(64)
    )`);

  stage = 'VERIFY_DIRECT_WRITES_DENIED';
  for (const table of [
    'operator_email_test_attempts',
    'operator_email_test_events',
    'pilot_manual_email_send_attempts',
    'pilot_manual_email_send_events',
  ]) {
    await assert.rejects(restrictedRaw.unsafe(`SELECT * FROM public.${table} LIMIT 1`));
  }
  await assert.rejects(restrictedRaw.unsafe(`
    INSERT INTO public.pilot_manual_email_send_attempts(
      contact_id, lead_id, channel, template_id, template_version,
      operator_principal_id, payload_fingerprint, idempotency_key
    ) VALUES (NULL, NULL, 'EMAIL', 'synthetic', 'v1', 'runtime-negative', repeat('a', 64), 'runtime-negative')`));
  await assert.rejects(restrictedRaw`
    INSERT INTO public.operator_channel_test_preparations(
      channel, purpose, recipient_fingerprint, template_id, template_version,
      operator_principal_fingerprint, payload_fingerprint, idempotency_fingerprint,
      message_fingerprint, result_fingerprint
    ) VALUES (
      'WHATSAPP', 'OPERATOR_TEST', ${'a'.repeat(64)}, 'operator-whatsapp-channel-test', 'v1',
      ${'b'.repeat(64)}, ${'c'.repeat(64)}, ${'d'.repeat(64)}, ${'e'.repeat(64)}, ${'f'.repeat(64)}
    )`);
  await assert.rejects(restrictedRaw`
    UPDATE public.operator_channel_test_preparations
    SET payload_fingerprint = ${'a'.repeat(64)}
    WHERE id = ${preparation.preparationId}::uuid`);
  await assert.rejects(restrictedRaw`
    DELETE FROM public.operator_channel_test_events
    WHERE preparation_id = ${preparation.preparationId}::uuid`);
  await assert.rejects(restrictedRaw`
    UPDATE public.schema_migrations
    SET version = version`);

  stage = 'VERIFY_OUTBOX_DENIED';
  await assert.rejects(restrictedRaw`
    SELECT payload FROM public.campaign_outbox LIMIT 1`);

  stage = 'VERIFY_DDL_DENIED';
  await assert.rejects(restrictedRaw.unsafe(
    'CREATE TABLE public.runtime_role_escape(id integer)',
  ));

  stage = 'VERIFY_GRANT_ESCALATION_NO_EFFECT';
  await restrictedRaw.unsafe(
    'GRANT SELECT ON TABLE public.campaign_outbox TO lead_finder_api_runtime',
  ).catch(() => undefined);
  await assert.rejects(restrictedRaw`
    SELECT payload FROM public.campaign_outbox LIMIT 1`);

  stage = 'VERIFY_ROLLBACK';
  await closeRestricted();
  closeRestricted = undefined;
  await restrictedRaw.end();
  restrictedRaw = undefined;

  await owner.unsafe(rollbackSql);
  await owner.unsafe(rollbackSql);
  const remaining = await owner<{ count: number }[]>`
    SELECT count(*)::int AS count FROM pg_roles WHERE rolname = ${roleName}`;
  assert.equal(remaining[0]?.count, 0);

  console.log(JSON.stringify({
    result: 'LEAST_PRIVILEGE_API_RUNTIME_ROLE_PASS',
    positiveFlow: 'PREPARED_OPENED_CONFIRMED_RESPONSE',
    readinessMode: 'restricted',
    directTableWrites: 'DENIED',
    outboxPayloadRead: 'DENIED',
    ddl: 'DENIED',
    grantEscalation: 'NO_EFFECT',
    rollbackReplay: 2,
  }));
} catch (error) {
  await writeFailureEvidence(stage, error);
  throw error;
} finally {
  if (closeRestricted) await closeRestricted().catch(() => undefined);
  if (restrictedRaw) await restrictedRaw.end().catch(() => undefined);
  await owner.unsafe(rollbackSql).catch(() => undefined);
  await owner.end();
}
