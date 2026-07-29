import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import {
  CONTACT_RESOLUTION_PURPOSE,
  createDatabase,
  ManualMessagingError,
  prepareManualMessage,
  recordManualOpen,
  resolveNarrowContact,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';
import { buildApp } from '../apps/api/src/app.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const raw = postgres(databaseUrl, { max: 8 });
const database = createDatabase(databaseUrl, { max: 8 });
const markerValues = [
  '+12025550100',
  '+12025550101',
  'private@example.test',
  'empresa@example.test',
] as const;
const marker = createHash('sha256').update(markerValues.join('|')).digest('hex');
const migration = await readFile(new URL('../database/migrations/0025_narrow_contact_resolution.sql', import.meta.url), 'utf8');
const createRoleSql = await readFile(new URL('../database/security/create_lead_finder_contact_resolver_runtime.sql', import.meta.url), 'utf8');
const rollbackRoleSql = await readFile(new URL('../database/security/rollback_lead_finder_contact_resolver_runtime.sql', import.meta.url), 'utf8');
const passed: string[] = [];
const pass = (name: string) => passed.push(name);
const actor = createAuthorizationContext({
  principalId: 'narrow-contact-test',
  permissions: new Set(['manual-messaging:prepare']),
  authenticationMethod: 'integration-test',
});

type Fixture = {
  pilotId: string;
  leadId: string;
  phoneId: string;
  secondPhoneId: string;
  emailId: string;
  authorizationId?: string;
};

let sequence = 0;
async function fixture(options: {
  authorize?: boolean;
  pilotStatus?: string;
  review?: 'APPROVED' | 'REJECTED';
  blocked?: boolean;
  doNotContact?: boolean;
  crmStage?: string;
  valid?: boolean;
  verified?: boolean;
  emailOwnership?: 'BUSINESS' | 'PERSONAL' | 'UNKNOWN';
  emailDecision?: 'APPROVED' | 'REJECTED';
  emailEvidence?: boolean;
} = {}): Promise<Fixture> {
  await raw`truncate contact_channel_authorization_revocations,pilot_manual_message_events,
    pilot_manual_message_preparations,contact_email_business_evidence,contact_channel_authorizations,
    pilot_reviews,pilot_leads,pilot_runs,campaign_provider_events,campaign_dead_letters,
    campaign_outbox,campaign_attempts,campaign_opt_outs,lead_contacts,leads restart identity cascade`;
  sequence += 1;
  const pilotId = randomUUID();
  const leadId = randomUUID();
  const phoneId = randomUUID();
  const secondPhoneId = randomUUID();
  const emailId = randomUUID();
  const suffix = String(sequence);
  return raw.begin(async (tx) => {
    await tx`insert into leads(id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,do_not_contact,crm_stage)
      values(${leadId}::uuid,'node',${`narrow-${suffix}`} ,'Empresa sintética','oficinas',90,
      'SEM_SITE_CADASTRADO',false,${options.blocked ?? false},${options.doNotContact ?? false},${options.crmStage ?? 'NOVO'})`;
    await tx`insert into pilot_runs(id,name,region,category,target_lead_count,status,created_by,started_at)
      values(${pilotId}::uuid,${`Narrow ${suffix}`} ,'SP','oficinas',1,${options.pilotStatus ?? 'RUNNING'},'integration-test',now())`;
    await tx`insert into pilot_leads(pilot_run_id,lead_id,source,added_by)
      values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`insert into pilot_reviews(pilot_run_id,lead_id,decision,reviewer_principal_id,version)
      values(${pilotId}::uuid,${leadId}::uuid,${options.review ?? 'APPROVED'},'reviewer',1)`;
    await tx`insert into lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp)
      values
      (${phoneId}::uuid,${leadId}::uuid,'TELEFONE',${markerValues[0]},${markerValues[0]},'PUBLIC_BUSINESS_SOURCE',1,
        ${options.verified === false ? null : new Date()}::timestamptz,${options.valid ?? true},true),
      (${secondPhoneId}::uuid,${leadId}::uuid,'PHONE',${markerValues[1]},${markerValues[1]},'PUBLIC_BUSINESS_SOURCE',1,now(),true,true),
      (${emailId}::uuid,${leadId}::uuid,'EMAIL',${markerValues[2]},${markerValues[2]},'PUBLIC_BUSINESS_SOURCE',1,now(),true,false)`;
    let authorizationId: string | undefined;
    if (options.authorize ?? true) {
      const rows = await tx<{ id: string }[]>`insert into contact_channel_authorizations(
        contact_id,lead_id,channel,purpose,origin,evidence_fingerprint,granted_at,recorded_by)
        values(${phoneId}::uuid,${leadId}::uuid,'WHATSAPP','B2B_PROSPECTION','DIRECT_OPT_IN',
          ${createHash('sha256').update(`authorization-${suffix}`).digest('hex')},now(),'integration-test')
        returning id`;
      authorizationId = rows[0]?.id;
    }
    if (options.emailEvidence ?? true)
      await tx`insert into contact_email_business_evidence(
        contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,human_decision,
        reviewer_principal_id,version)
        values(${emailId}::uuid,${leadId}::uuid,'EMAIL',${options.emailOwnership ?? 'BUSINESS'},
          'PUBLIC_BUSINESS_SOURCE',${createHash('sha256').update(`email-${suffix}`).digest('hex')},
          ${options.emailDecision ?? 'APPROVED'},'reviewer',1)`;
    return { pilotId, leadId, phoneId, secondPhoneId, emailId, authorizationId };
  });
}

const resolve = (item: Fixture, overrides: Partial<Parameters<typeof resolveNarrowContact>[1]> = {}) =>
  resolveNarrowContact(database.db, {
    pilotRunId: item.pilotId,
    leadId: item.leadId,
    contactId: item.phoneId,
    requestedChannel: 'WHATSAPP',
    principalId: 'localhost-manual-console',
    action: 'MANUAL_MESSAGE_OPEN',
    purpose: CONTACT_RESOLUTION_PURPOSE,
    localManualMode: true,
    noProviderMode: true,
    killSwitchEnabled: false,
    manualMessagingEnabled: true,
    realProviderEnabled: false,
    ...overrides,
  });
const ineligible = async (promise: Promise<unknown>) =>
  assert.rejects(promise, (error: unknown) =>
    error instanceof ManualMessagingError && error.code === 'INELIGIBLE');
const tableCount = async (table: string) =>
  Number((await raw.unsafe(`select count(*)::int value from ${table}`))[0]?.value ?? -1);
const foreignContact = async () => {
  const leadId = randomUUID();
  const contactId = randomUUID();
  await raw.begin(async (tx) => {
    await tx`insert into leads(id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,do_not_contact,crm_stage)
      values(${leadId}::uuid,'node',${`foreign-${sequence}`} ,'Empresa sintética','oficinas',90,
      'SEM_SITE_CADASTRADO',false,false,false,'NOVO')`;
    await tx`insert into lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp)
      values(${contactId}::uuid,${leadId}::uuid,'EMAIL',${markerValues[3]},${markerValues[3]},
      'PUBLIC_BUSINESS_SOURCE',1,now(),true,false)`;
  });
  return { leadId, contactId };
};
const unchangedExternalTables = async (before: readonly number[]) => {
  assert.deepEqual(
    await Promise.all([
      tableCount('campaign_outbox'),
      tableCount('campaign_dead_letters'),
      tableCount('campaign_provider_events'),
    ]),
    before,
  );
};
const concurrentOptOut = async (item: Fixture, channel: 'WHATSAPP' | null) => {
  const writer = postgres(databaseUrl, { max: 1 });
  let release!: () => void;
  let inserted!: () => void;
  const releasePromise = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  const insertedPromise = new Promise<void>((resolveInserted) => { inserted = resolveInserted; });
  const externalBefore = await Promise.all([
    tableCount('campaign_outbox'),
    tableCount('campaign_dead_letters'),
    tableCount('campaign_provider_events'),
  ]);
  const write = writer.begin(async (tx) => {
    await tx`insert into campaign_opt_outs(lead_id,channel,reason,source)
      values(${item.leadId}::uuid,${channel},'integration','integration')`;
    inserted();
    await releasePromise;
  });
  try {
    await insertedPromise;
    let settled = false;
    const resolution = resolve(item).finally(() => { settled = true; });
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    assert.equal(settled, false);
    release();
    await write;
    await ineligible(resolution);
    await unchangedExternalTables(externalBefore);
  } finally {
    release();
    await write.catch(() => undefined);
    await writer.end();
  }
};
const executablePublicFunctions = async () =>
  raw<{ signature: string }[]>`
    select procedure_record.oid::regprocedure::text signature
    from pg_proc procedure_record
    join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
    where namespace_record.nspname='public'
      and has_function_privilege(
        'lead_finder_contact_resolver_runtime',
        procedure_record.oid,
        'EXECUTE'
      )
      and procedure_record.oid <>
        'public.resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)'::regprocedure
    order by 1`;

try {
  await raw.unsafe(migration);
  await raw.unsafe(migration);
  const exact = await fixture();
  const exactResolved = await resolve(exact);
  assert.equal(exactResolved.fingerprint, createHash('sha256').update(markerValues[0]).digest('hex'));
  pass('01 exact contact among two contacts');

  const foreign = await foreignContact();
  await ineligible(resolve(exact, { contactId: foreign.contactId }));
  pass('02 contact from another lead rejected');
  await ineligible(resolve(exact, { contactId: exact.phoneId, requestedChannel: 'EMAIL' }));
  pass('03 requested channel has no fallback');

  const noAuthorization = await fixture({ authorize: false });
  await ineligible(resolve(noAuthorization));
  pass('04 WhatsApp requires explicit authorization');
  await raw`insert into contact_channel_authorizations(contact_id,lead_id,channel,purpose,origin,evidence_fingerprint,granted_at,recorded_by)
    values(${noAuthorization.secondPhoneId}::uuid,${noAuthorization.leadId}::uuid,'WHATSAPP','B2B_PROSPECTION','DIRECT_OPT_IN',
    ${createHash('sha256').update('other-contact').digest('hex')},now(),'integration-test')`;
  await ineligible(resolve(noAuthorization));
  pass('05 authorization from another contact rejected');
  const otherLead = await foreignContact();
  await ineligible(resolve(noAuthorization, { leadId: otherLead.leadId }));
  pass('06 authorization from another lead rejected');

  const personalEmail = await fixture({ emailOwnership: 'PERSONAL' });
  await ineligible(resolve(personalEmail, { contactId: personalEmail.emailId, requestedChannel: 'EMAIL' }));
  pass('07 email requires BUSINESS APPROVED');
  const otherEvidence = await fixture({ emailEvidence: false });
  const otherEmailId = randomUUID();
  await raw`insert into lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp)
    values(${otherEmailId}::uuid,${otherEvidence.leadId}::uuid,'EMAIL',${markerValues[3]},${markerValues[3]},
    'PUBLIC_BUSINESS_SOURCE',1,now(),true,false)`;
  await raw`insert into contact_email_business_evidence(contact_id,lead_id,channel,ownership,origin,
    evidence_fingerprint,human_decision,reviewer_principal_id,version)
    values(${otherEmailId}::uuid,${otherEvidence.leadId}::uuid,'EMAIL','BUSINESS',
    'PUBLIC_BUSINESS_SOURCE',${createHash('sha256').update('other-evidence').digest('hex')},
    'APPROVED','reviewer',1)`;
  await ineligible(resolve(otherEvidence, { contactId: otherEvidence.emailId, requestedChannel: 'EMAIL' }));
  pass('08 evidence from another contact rejected');
  const rejectedEmail = await fixture();
  await raw`insert into contact_email_business_evidence(contact_id,lead_id,channel,ownership,origin,
    evidence_fingerprint,human_decision,reviewer_principal_id,version)
    values(${rejectedEmail.emailId}::uuid,${rejectedEmail.leadId}::uuid,'EMAIL','BUSINESS',
    'PUBLIC_BUSINESS_SOURCE',${createHash('sha256').update('latest-rejected').digest('hex')},
    'REJECTED','reviewer',2)`;
  await ineligible(resolve(rejectedEmail, { contactId: rejectedEmail.emailId, requestedChannel: 'EMAIL' }));
  pass('09 latest rejected evidence wins');

  const revoked = await fixture();
  const revocationInput = {
    contactId: revoked.phoneId,
    requestedChannel: 'WHATSAPP' as const,
    templateId: 'pilot-whatsapp-first-contact',
    templateVersion: 'v1',
    idempotencyKey: randomUUID(),
  };
  const preparedBeforeRevocation = await prepareManualMessage(
    database.db,
    revoked.pilotId,
    revoked.leadId,
    revocationInput,
    actor,
  );
  assert.equal(preparedBeforeRevocation.state, 'PREPARED');
  assert.ok(revoked.authorizationId);
  await raw`insert into contact_channel_authorization_revocations(
    authorization_id,contact_id,lead_id,purpose,revoked_by,reason_fingerprint)
    values(${revoked.authorizationId!}::uuid,${revoked.phoneId}::uuid,${revoked.leadId}::uuid,
    'B2B_PROSPECTION','integration-test',${marker})`;
  await ineligible(resolve(revoked));
  await ineligible(recordManualOpen(
    database.db,
    preparedBeforeRevocation.preparationId,
    { idempotencyKey: randomUUID() },
    actor,
  ));
  assert.equal(
    Number((await raw`select count(*)::int value from pilot_manual_message_events
      where preparation_id=${preparedBeforeRevocation.preparationId}::uuid
        and event_type='OPENED'`)[0]?.value),
    0,
  );
  await unchangedExternalTables([0, 0, 0]);
  pass('10 real preparation is revoked before resolution and OPENED');

  const globalOptOut = await fixture();
  await concurrentOptOut(globalOptOut, null);
  pass('11 concurrent global opt-out commits before resolution');
  const channelOptOut = await fixture();
  await concurrentOptOut(channelOptOut, 'WHATSAPP');
  pass('12 concurrent channel opt-out commits before resolution');
  await ineligible(resolve(await fixture({ doNotContact: true }))); pass('13 do not contact blocks');
  await ineligible(resolve(await fixture({ crmStage: 'NAO_CONTATAR' }))); pass('14 NAO_CONTATAR blocks');
  await ineligible(resolve(await fixture({ blocked: true }))); pass('15 administrative block blocks');
  await ineligible(resolve(await fixture({ pilotStatus: 'PAUSED' }))); pass('16 non-running pilot blocks');
  await ineligible(resolve(await fixture({ review: 'REJECTED' }))); pass('17 non-approved review blocks');
  await ineligible(resolve(await fixture({ valid: false }))); pass('18 invalid contact blocks');
  await ineligible(resolve(await fixture({ verified: false }))); pass('19 unverified contact blocks');
  const safe = await fixture();
  await ineligible(resolve(safe, { killSwitchEnabled: true })); pass('20 kill switch blocks');
  await ineligible(resolve(safe, { noProviderMode: false })); pass('21 no-provider mode required');

  const effectsBefore = await Promise.all([
    tableCount('campaign_outbox'),
    tableCount('campaign_dead_letters'),
    tableCount('campaign_provider_events'),
  ]);
  const resolvedSafe = await resolve(safe);
  assert.equal(resolvedSafe.fingerprint, createHash('sha256').update(markerValues[0]).digest('hex'));
  pass('22 resolver returns only exact approved contact');
  await unchangedExternalTables(effectsBefore); pass('23 resolution creates no external effects');

  const token = 'synthetic-narrow-api-token';
  const httpFixture = await fixture();
  const httpUrl = `/pilots/${httpFixture.pilotId}/leads/${httpFixture.leadId}/manual-messages/prepare`;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const logChunks: string[] = [];
  const capture = (chunk: string | Uint8Array) => {
    logChunks.push(String(chunk));
    return true;
  };
  process.stdout.write = capture as typeof process.stdout.write;
  process.stderr.write = capture as typeof process.stderr.write;
  const app = buildApp(database.db, {
    authentication: {
      token,
      principalId: 'http-narrow-operator',
      principalPermissions: ['manual-messaging:prepare'],
    },
  });
  let httpText = '';
  try {
    const response = await app.inject({
      method: 'POST',
      url: httpUrl,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        contactId: httpFixture.phoneId,
        requestedChannel: 'WHATSAPP',
        templateId: 'pilot-whatsapp-first-contact',
        templateVersion: 'v1',
      },
    });
    assert.equal(response.statusCode, 201);
    const body = response.json<Record<string, unknown>>();
    assert.deepEqual(Object.keys(body).sort(), [
      'channel',
      'contactFingerprint',
      'messageFingerprint',
      'preparationId',
      'preparedAt',
      'replayed',
      'state',
      'templateId',
      'templateVersion',
    ]);
    httpText = response.body;
    for (const forbidden of [
      'message', 'subject', 'link', 'url', 'phone', 'email', 'contactValue',
      'normalizedValue', 'recipient', 'destination',
    ]) assert.equal(Object.hasOwn(body, forbidden), false);
    assert.ok(markerValues.every((value) => !httpText.includes(value)));
  } finally {
    await app.close();
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  pass('24 actual HTTP route returns exact safe contract');
  const actualLogs = logChunks.join('');
  assert.ok(markerValues.every((value) => !actualLogs.includes(value)));
  assert.ok(!actualLogs.includes('wa.me/') && !actualLogs.includes('mailto:'));
  assert.match(actualLogs, /manual_message_prepared/);
  pass('25 actual Fastify logs contain safe metadata only');
  const persistedSurfaces = JSON.stringify(await raw`
    select
      (select coalesce(jsonb_agg(metadata),'[]'::jsonb) from pilot_timeline_events) timeline,
      (select coalesce(jsonb_agg(result_snapshot),'[]'::jsonb)
        from pilot_manual_message_preparations) snapshots,
      (select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb)
        from campaign_outbox item) outbox,
      (select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb)
        from campaign_dead_letters item) dead_letters,
      (select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb)
        from campaign_provider_events item) provider_events`);
  assert.ok(markerValues.every((value) => !persistedSurfaces.includes(value)));
  pass('26 persisted safe surfaces exclude raw markers');

  const replayFixture = await fixture();
  const input = { contactId: replayFixture.phoneId, requestedChannel: 'WHATSAPP' as const,
    templateId: 'pilot-whatsapp-first-contact', templateVersion: 'v1', idempotencyKey: randomUUID() };
  const first = await prepareManualMessage(database.db, replayFixture.pilotId, replayFixture.leadId, input, actor);
  const replay = await prepareManualMessage(database.db, replayFixture.pilotId, replayFixture.leadId, input, actor);
  const snapshotText = JSON.stringify(await raw`select result_snapshot from pilot_manual_message_preparations
    where id=${first.preparationId}::uuid`);
  assert.ok(markerValues.every((value) => !snapshotText.includes(value))); pass('27 snapshots exclude marker');
  assert.equal(replay.preparationId, first.preparationId);
  assert.equal(replay.contactFingerprint, first.contactFingerprint);
  assert.equal(replay.messageFingerprint, first.messageFingerprint); pass('28 replay preserves IDs and fingerprints');

  const acl = await raw<{ count: number }[]>`
    select count(*)::int count
    from pg_proc procedure_record
    join pg_namespace namespace_record on namespace_record.oid=procedure_record.pronamespace
    cross join lateral aclexplode(coalesce(
      procedure_record.proacl,
      acldefault('f',procedure_record.proowner)
    )) privilege_record
    where namespace_record.nspname='public'
      and procedure_record.oid='public.resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)'::regprocedure
      and privilege_record.grantee=0`;
  assert.equal(acl[0]?.count, 0); pass('29 PUBLIC has no resolver execute');

  const driverCreateRoleSql = createRoleSql.replace(/^\\set ON_ERROR_STOP on\s*/m, '');
  await raw.unsafe(driverCreateRoleSql);
  const attributes = (await raw<{
    rolcanlogin: boolean;
    rolinherit: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }[]>`select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,
      rolreplication,rolbypassrls
    from pg_roles where rolname='lead_finder_contact_resolver_runtime'`)[0];
  assert.deepEqual(attributes, {
    rolcanlogin: true,
    rolinherit: false,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
  });
  pass('30 role SQL executed and attributes verified');
  const memberships = Number((await raw`select count(*)::int value
    from pg_auth_members membership
    join pg_roles member_role on member_role.oid=membership.member
    where member_role.rolname='lead_finder_contact_resolver_runtime'`)[0]?.value);
  assert.equal(memberships, 0);
  pass('31 role has zero memberships');
  const privileges = (await raw<{
    connect: boolean;
    schema_usage: boolean;
    contacts_select: boolean;
    outbox_select: boolean;
    dead_select: boolean;
    resolver_execute: boolean;
  }[]>`select
      has_database_privilege('lead_finder_contact_resolver_runtime',current_database(),'CONNECT') connect,
      has_schema_privilege('lead_finder_contact_resolver_runtime','public','USAGE') schema_usage,
      has_table_privilege('lead_finder_contact_resolver_runtime','public.lead_contacts','SELECT') contacts_select,
      has_table_privilege('lead_finder_contact_resolver_runtime','public.campaign_outbox','SELECT') outbox_select,
      has_table_privilege('lead_finder_contact_resolver_runtime','public.campaign_dead_letters','SELECT') dead_select,
      has_function_privilege('lead_finder_contact_resolver_runtime',
        'public.resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)','EXECUTE') resolver_execute`)[0];
  assert.deepEqual(privileges, {
    connect: true,
    schema_usage: true,
    contacts_select: false,
    outbox_select: false,
    dead_select: false,
    resolver_execute: true,
  });
  assert.deepEqual(await executablePublicFunctions(), []);
  pass('32 role ACL is exact and executable function allowlist is empty');
  const roleFixture = await fixture();
  await raw.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE lead_finder_contact_resolver_runtime');
    const roleResolved = await tx<{ contact_value: string; contact_fingerprint: string }[]>`
      select contact_value,contact_fingerprint
      from public.resolve_narrow_contact(
        ${roleFixture.pilotId}::uuid,
        ${roleFixture.leadId}::uuid,
        ${roleFixture.phoneId}::uuid,
        'WHATSAPP',
        'runtime-role-test',
        'MANUAL_MESSAGE_OPEN',
        'B2B_PROSPECTION'
      )`;
    assert.equal(roleResolved.length, 1);
    assert.equal(
      roleResolved[0]?.contact_fingerprint.trim(),
      createHash('sha256').update(markerValues[0]).digest('hex'),
    );
  });
  await assert.rejects(raw.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE lead_finder_contact_resolver_runtime');
    await tx`select normalized_value from public.lead_contacts
      where id=${roleFixture.phoneId}::uuid`;
  }));
  pass('33 allowlisted function resolves exact contact and direct SELECT is denied');

  const rolesBeforeRollback = (await raw<{ rolname: string }[]>`
    select rolname from pg_roles
    where rolname<>'lead_finder_contact_resolver_runtime'
    order by rolname`).map((item) => item.rolname);
  const migrationCountBefore = Number((await raw`select count(*)::int value
    from schema_migrations where version='0025_narrow_contact_resolution'`)[0]?.value);
  const driverRollbackSql = rollbackRoleSql.replace(/^\\set ON_ERROR_STOP on\s*/m, '');
  await raw.unsafe(driverRollbackSql);
  assert.equal(Number((await raw`select count(*)::int value from pg_roles
    where rolname='lead_finder_contact_resolver_runtime'`)[0]?.value), 0);
  assert.equal(
    Number((await raw`select count(*)::int value from schema_migrations
      where version='0025_narrow_contact_resolution'`)[0]?.value),
    migrationCountBefore,
  );
  assert.ok((await raw`select to_regclass('public.leads') value`)[0]?.value);
  assert.ok((await raw`select to_regclass('public.lead_contacts') value`)[0]?.value);
  assert.deepEqual(
    (await raw<{ rolname: string }[]>`select rolname from pg_roles
      where rolname<>'lead_finder_contact_resolver_runtime' order by rolname`)
      .map((item) => item.rolname),
    rolesBeforeRollback,
  );
  pass('34 rollback executes and preserves migration, tables, and unrelated roles');
  assert.equal(
    (await raw`select has_database_privilege(
      'public',current_database(),'CONNECT') value`)[0]?.value,
    true,
  );
  assert.equal(
    Number((await raw`select count(*)::int value
      from information_schema.role_table_grants
      where grantee='lead_finder_contact_resolver_runtime'`)[0]?.value),
    0,
  );
  pass('35 removed role retains no grants while unrelated PUBLIC connect remains');

  assert.equal(passed.length, 35);
  console.log(JSON.stringify({
    result: 'NARROW_CONTACT_RESOLUTION_POSTGRES_PASS',
    mandatoryTests: passed.length,
    providerCalls: 0,
    networkMessageCalls: 0,
    revocationAfterRealPreparation: true,
    globalOptOutTrueConcurrency: true,
    channelOptOutTrueConcurrency: true,
    actualHttpRoute: true,
    actualFastifyLog: true,
    roleSqlExecuted: true,
    roleRollbackExecuted: true,
  }));
} finally {
  await database.close();
  await raw.end();
}
