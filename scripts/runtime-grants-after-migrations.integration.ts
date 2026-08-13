import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { collectionCityId } from '@lead-finder/shared';

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
  '0056_daily6_automated_compliance',
  '0057_collection_enqueue_security_definer',
  '0058_collection_enqueue_fail_closed_hardening',
  '0059_collection_enqueue_city_normalization_parity',
  '0060_daily6_collection_terminal_reconciliation',
  '0061_daily6_progressive_discovery_pool',
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
const daily6Functions = [
  'reserve_daily6_send',
  'finalize_daily6_send',
  'list_daily6_candidates',
  'prepare_daily6_pilot_context',
  'ensure_daily6_batch',
  'bump_daily6_batch_metrics',
  'sync_daily6_batch_from_collection',
  'enqueue_collection_job',
] as const;
const restrictedTables = [
  'lead_contacts',
  'pilot_manual_message_preparations',
  'pilot_manual_message_events',
  'pilot_manual_email_send_attempts',
  'pilot_manual_email_send_events',
] as const;
const enqueueBoundaryTables = ['daily6_batches', 'collection_jobs'] as const;

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

const daily6FunctionPrivileges = () => owner<{ identity: string; executable: boolean }[]>`
  select procedure_record.oid::regprocedure::text as identity,
    has_function_privilege(${roleName}, procedure_record.oid, 'EXECUTE') as executable
  from pg_proc procedure_record
  join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
  where namespace_record.nspname='lead_finder_internal'
    and procedure_record.proname in ${owner(daily6Functions)}
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

const assertEnqueueBoundaryDenied = async () => {
  const rows = await owner<{ name: string; privileged: boolean }[]>`
    select table_record.relname as name,
      (
        has_table_privilege(${roleName}, table_record.oid, 'SELECT')
        or has_table_privilege(${roleName}, table_record.oid, 'INSERT')
        or has_table_privilege(${roleName}, table_record.oid, 'UPDATE')
        or has_table_privilege(${roleName}, table_record.oid, 'DELETE')
      ) as privileged
    from pg_class table_record
    join pg_namespace namespace_record on namespace_record.oid=table_record.relnamespace
    where namespace_record.nspname='public'
      and table_record.relname in ${owner(enqueueBoundaryTables)}`;
  assert.equal(rows.length, enqueueBoundaryTables.length);
  assert.equal(rows.some((row) => row.privileged), false);
};

try {
  const applied = await owner<{ version: string }[]>`
    select version from public.schema_migrations
    where version in ${owner(migrationVersions)}`;
  assert.equal(applied.length, migrationVersions.length, '0042-0047 must be applied first');
  const daily6Applied = await owner<{ version: string }[]>`
    select version from public.schema_migrations where version = '0055_daily6_atomic_reservations'`;
  assert.equal(daily6Applied.length, 1, '0055 must be applied before runtime grants are verified');

  await owner.unsafe(
    `ALTER ROLE ${roleName} PASSWORD '${rolePassword.replaceAll("'", "''")}'`,
  );

  const before = await functionPrivileges();
  assert.equal(before.length, hmlFunctions.length);
  assert.equal(before.some((row) => row.executable), false, 'pre-fix state must reproduce SQLSTATE 42501');
  const daily6Before = await daily6FunctionPrivileges();
  assert.equal(daily6Before.length, daily6Functions.length);
  // Migrations 0055-0056 grant the existing internal functions when the
  // least-privilege role already exists. Migration 0057 deliberately leaves
  // the new enqueue boundary closed until the HML supplement is applied.
  assert.equal(daily6Before
    .filter((row) => !row.identity.startsWith('lead_finder_internal.enqueue_collection_job'))
    .every((row) => row.executable), true);
  assert.equal(daily6Before
    .filter((row) => row.identity.startsWith('lead_finder_internal.enqueue_collection_job'))
    .every((row) => !row.executable), true);
  await assertRestrictedTablesDenied();
  await assertEnqueueBoundaryDenied();

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
  const daily6After = await daily6FunctionPrivileges();
  assert.equal(daily6After.length, daily6Functions.length);
  assert.equal(daily6After.every((row) => row.executable), true);
  const internalSchemaUsage = await owner<{ usable: boolean }[]>`
    select has_schema_privilege(${roleName}, 'lead_finder_internal', 'USAGE') as usable`;
  assert.equal(internalSchemaUsage[0]?.usable, true);
  await assertRestrictedTablesDenied();
  await assertEnqueueBoundaryDenied();

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
    select rolname from pg_roles where rolname in ('anon','authenticated','service_role')`;
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

  const enqueuePublicExecute = await owner<{ executable: boolean | null }[]>`
    select bool_or(privilege.privilege_type='EXECUTE') as executable
    from pg_proc procedure_record
    join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
    ) privilege
    where namespace_record.nspname='lead_finder_internal'
      and procedure_record.proname='enqueue_collection_job'
      and privilege.grantee=0`;
  assert.equal(enqueuePublicExecute[0]?.executable === true, false);
  for (const { rolname: principal } of principals) {
    const denied = await owner<{ executable: boolean }[]>`
      select has_function_privilege(${principal}, 'lead_finder_internal.enqueue_collection_job(text,jsonb)'::regprocedure, 'EXECUTE') as executable`;
    assert.equal(denied[0]?.executable, false, `${principal} must not execute enqueue boundary`);
  }

  const runtimeDb = postgres(roleUrl.toString(), { max: 4 });
  const identityCity = `Synthetic City ${process.pid}`;
  const identityState = 'SP';
  const identity = `2099-12-31|09|${collectionCityId(identityCity, identityState)}|daily6-v1`;
  const rollbackCity = `Rollback City ${process.pid}`;
  const rollbackState = 'SP';
  const rollbackIdentity = `2099-12-30|09|${collectionCityId(rollbackCity, rollbackState)}|daily6-v1`;
  const normalizationIdentities: string[] = [];
  const payload = {
    input: { city: identityCity, state: identityState, country: 'Brasil', category: 'oficinas', limit: 1 },
    collectionEgress: { enabled: true, configurationVersion: 1 },
    collectionRequestIdentity: identity,
  };
  const rollbackPayload = {
    ...payload,
    input: { ...payload.input, city: rollbackCity, state: rollbackState },
    collectionRequestIdentity: rollbackIdentity,
  };
  const payloadShape = await owner<{ input_type: string; identity: string; enabled: string; config_version: string }[]>`
    with value as (select ${owner.json(payload)}::jsonb as payload)
    select
      jsonb_typeof(payload->'input') as input_type,
      payload->>'collectionRequestIdentity' as identity,
      payload->'collectionEgress'->>'enabled' as enabled,
      payload->'collectionEgress'->>'configurationVersion' as config_version
    from value`;
  assert.deepEqual(payloadShape[0], {
    input_type: 'object',
    identity,
    enabled: 'true',
    config_version: '1',
  });
  const enqueue = () => runtimeDb<{ id: string; status: string; replayed: boolean }[]>`
    select * from lead_finder_internal.enqueue_collection_job(${identity}, ${runtimeDb.json(payload)}::jsonb)`;
  const assertRejectedPayload = async (label: string, invalidPayload: Parameters<typeof runtimeDb.json>[0]) => {
    await assert.rejects(
      runtimeDb`select * from lead_finder_internal.enqueue_collection_job(${identity}, ${runtimeDb.json(invalidPayload)}::jsonb)`,
      (error: unknown) => (error as { code?: unknown }).code === '22023',
      label,
    );
    const counts = await owner<{ batches: number; jobs: number }[]>`
      select
        (select count(*)::int from public.daily6_batches where batch_id=${identity}) as batches,
        (select count(*)::int from public.collection_jobs where request_identity=${identity}) as jobs`;
    assert.equal(counts[0]?.batches, 0, `${label}: no batch may remain`);
    assert.equal(counts[0]?.jobs, 0, `${label}: no job may remain`);
  };
  try {
    const first = (await enqueue())[0];
    assert.equal(first?.replayed, false);
    const replay = (await enqueue())[0];
    assert.equal(replay?.replayed, true);
    assert.equal(replay?.id, first?.id);
    const concurrent = await Promise.all([enqueue(), enqueue(), enqueue()]);
    assert.equal(concurrent.filter((rows) => rows[0]?.id === first?.id).length, 3);
    const counts = await owner<{ batches: number; jobs: number }[]>`
      select
        (select count(*)::int from public.daily6_batches where batch_id=${identity}) as batches,
        (select count(*)::int from public.collection_jobs where request_identity=${identity}) as jobs`;
    assert.equal(counts[0]?.batches, 1);
    assert.equal(counts[0]?.jobs, 1);

    // Use a fresh identity for rejection tests so every invalid authorization
    // case is proven to leave both tables empty before any INSERT.
    await owner`delete from public.collection_jobs where request_identity=${identity}`;
    await owner`delete from public.daily6_batches where batch_id=${identity}`;
    const validInput = payload.input;
    const validEgress = payload.collectionEgress;
    await assertRejectedPayload('missing collectionEgress', {
      input: validInput,
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('null collectionEgress', {
      input: validInput,
      collectionEgress: null,
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('missing egress enabled', {
      input: validInput,
      collectionEgress: { configurationVersion: 1 },
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('null egress enabled', {
      input: validInput,
      collectionEgress: { enabled: null, configurationVersion: 1 },
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('wrong egress enabled', {
      input: validInput,
      collectionEgress: { enabled: false, configurationVersion: 1 },
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('string egress enabled', {
      input: validInput,
      collectionEgress: { enabled: 'true', configurationVersion: 1 },
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('missing egress version', {
      input: validInput,
      collectionEgress: { enabled: true },
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('null egress version', {
      input: validInput,
      collectionEgress: { enabled: true, configurationVersion: null },
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('wrong egress version', {
      input: validInput,
      collectionEgress: { enabled: true, configurationVersion: 2 },
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('string egress version', {
      input: validInput,
      collectionEgress: { enabled: true, configurationVersion: '1' },
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('missing payload identity', {
      input: validInput,
      collectionEgress: validEgress,
    });
    await assertRejectedPayload('null payload identity', {
      input: validInput,
      collectionEgress: validEgress,
      collectionRequestIdentity: null,
    });
    await assertRejectedPayload('mismatched payload identity', {
      input: validInput,
      collectionEgress: validEgress,
      collectionRequestIdentity: '2099-12-31|09|other-city|daily6-v1',
    });
    await assertRejectedPayload('missing input', {
      collectionEgress: validEgress,
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('null input', {
      input: null,
      collectionEgress: validEgress,
      collectionRequestIdentity: identity,
    });
    await assertRejectedPayload('non-object input', {
      input: [],
      collectionEgress: validEgress,
      collectionRequestIdentity: identity,
    });
    await assert.rejects(
      runtimeDb`select * from lead_finder_internal.enqueue_collection_job(${null}::text, ${runtimeDb.json(payload)}::jsonb)`,
      (error: unknown) => (error as { code?: unknown }).code === '22023',
      'null request identity',
    );
    await assert.rejects(
      runtimeDb`select * from lead_finder_internal.enqueue_collection_job(${'2099-02-30|09|campinas-sp|daily6-v1'}, ${runtimeDb.json(payload)}::jsonb)`,
      (error: unknown) => (error as { code?: unknown }).code === '22023',
      'invalid request identity date',
    );

    const normalizationCases = [
      { date: '2099-12-20', slot: '09', city: 'Campinas', state: 'SP' },
      { date: '2099-12-21', slot: '13', city: 'São José dos Campos', state: 'SP' },
      { date: '2099-12-22', slot: '16', city: 'Campinas', state: 'São Paulo' },
      { date: '2099-12-23', slot: '09', city: 'Cidade / Centro', state: 'SP / Região' },
      { date: '2099-12-24', slot: '13', city: '\u00c1guas de Lind\u00f3ia', state: 'SP' },
      { date: '2099-12-25', slot: '16', city: 'Sa\u0303o Jose\u0301', state: 'SP' },
    ] as const;
    for (const normalizationCase of normalizationCases) {
      const caseCityId = collectionCityId(normalizationCase.city, normalizationCase.state);
      const caseIdentity = `${normalizationCase.date}|${normalizationCase.slot}|${caseCityId}|daily6-v1`;
      normalizationIdentities.push(caseIdentity);
      const result = await runtimeDb<{ id: string; status: string; replayed: boolean }[]>`
        select * from lead_finder_internal.enqueue_collection_job(
          ${caseIdentity},
          ${runtimeDb.json({
            input: { city: normalizationCase.city, state: normalizationCase.state, country: 'Brasil', category: 'oficinas', limit: 1 },
            collectionEgress: { enabled: true, configurationVersion: 1 },
            collectionRequestIdentity: caseIdentity,
          })}::jsonb
        )`;
      assert.equal(result[0]?.replayed, false, `canonical normalization: ${caseIdentity}`);
    }

    await assert.rejects(
      runtimeDb`select * from lead_finder_internal.enqueue_collection_job(${identity}, ${runtimeDb.json({ ...payload, collectionRequestIdentity: '2099-12-31|09|other-city|daily6-v1' })}::jsonb)`,
      (error: unknown) => (error as { code?: unknown }).code === '22023',
    );

    await owner.unsafe(`
      CREATE OR REPLACE FUNCTION public.collection_enqueue_test_fail()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'COLLECTION_ENQUEUE_TEST_FAILURE';
      END;
      $$;
      DROP TRIGGER IF EXISTS collection_enqueue_test_fail_trigger ON public.collection_jobs;
      CREATE TRIGGER collection_enqueue_test_fail_trigger
      BEFORE INSERT ON public.collection_jobs
      FOR EACH ROW
      WHEN (NEW.request_identity = '${rollbackIdentity}')
      EXECUTE FUNCTION public.collection_enqueue_test_fail();
    `);
    await assert.rejects(
      runtimeDb`select * from lead_finder_internal.enqueue_collection_job(${rollbackIdentity}, ${runtimeDb.json(rollbackPayload)}::jsonb)`,
      (error: unknown) => (error as { code?: unknown }).code === 'P0001',
    );
    const rollbackCounts = await owner<{ batches: number; jobs: number }[]>`
      select
        (select count(*)::int from public.daily6_batches where batch_id=${rollbackIdentity}) as batches,
        (select count(*)::int from public.collection_jobs where request_identity=${rollbackIdentity}) as jobs`;
    assert.equal(rollbackCounts[0]?.batches, 0);
    assert.equal(rollbackCounts[0]?.jobs, 0);
  } finally {
    await runtimeDb.end();
    await owner.unsafe('DROP TRIGGER IF EXISTS collection_enqueue_test_fail_trigger ON public.collection_jobs');
    await owner.unsafe('DROP FUNCTION IF EXISTS public.collection_enqueue_test_fail()');
    await owner`delete from public.collection_jobs where request_identity=${identity}`;
    await owner`delete from public.daily6_batches where batch_id=${identity}`;
    await owner`delete from public.collection_jobs where request_identity=${rollbackIdentity}`;
    await owner`delete from public.daily6_batches where batch_id=${rollbackIdentity}`;
    for (const normalizationIdentity of normalizationIdentities) {
      await owner`delete from public.collection_jobs where request_identity=${normalizationIdentity}`;
      await owner`delete from public.daily6_batches where batch_id=${normalizationIdentity}`;
    }
  }

  console.log(JSON.stringify({
    result: 'RUNTIME_GRANTS_AFTER_MIGRATIONS_PASS',
    preFix: '42501',
    postFixFunctions: after.length,
    daily6Functions: daily6After.length,
    replay: 2,
    restrictedTablesDenied: true,
    enqueueBoundary: 'atomic-security-definer',
    enqueueReplay: true,
    enqueueConcurrent: true,
    enqueueRollback: true,
  }));
} finally {
  await owner.end();
}
