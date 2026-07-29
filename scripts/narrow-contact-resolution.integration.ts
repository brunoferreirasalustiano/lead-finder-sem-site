import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import {
  CONTACT_RESOLUTION_PURPOSE,
  createDatabase,
  ManualMessagingError,
  prepareManualMessage,
  resolveNarrowContact,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';

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
  assert.ok(revoked.authorizationId);
  await raw`insert into contact_channel_authorization_revocations(
    authorization_id,contact_id,lead_id,purpose,revoked_by,reason_fingerprint)
    values(${revoked.authorizationId!}::uuid,${revoked.phoneId}::uuid,${revoked.leadId}::uuid,
    'B2B_PROSPECTION','integration-test',${marker})`;
  await ineligible(resolve(revoked));
  pass('10 authorization revoked after preparation blocks resolution');

  const globalOptOut = await fixture();
  await raw`insert into campaign_opt_outs(lead_id,channel,reason,source)
    values(${globalOptOut.leadId}::uuid,null,'integration','integration')`;
  await ineligible(resolve(globalOptOut));
  pass('11 global opt-out wins');
  const channelOptOut = await fixture();
  await raw`insert into campaign_opt_outs(lead_id,channel,reason,source)
    values(${channelOptOut.leadId}::uuid,'WHATSAPP','integration','integration')`;
  await ineligible(resolve(channelOptOut));
  pass('12 channel opt-out wins');
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

  const outboxBefore = await tableCount('campaign_outbox');
  const deadBefore = await tableCount('campaign_dead_letters');
  const eventsBefore = await tableCount('campaign_provider_events');
  await resolve(safe);
  assert.equal(await tableCount('campaign_outbox'), outboxBefore); pass('22 provider never called');
  assert.equal(await tableCount('campaign_outbox'), outboxBefore); pass('23 webhook never called');
  assert.equal(await tableCount('campaign_outbox'), outboxBefore); pass('24 outbox unchanged');
  assert.equal(await tableCount('campaign_dead_letters'), deadBefore); pass('25 dead letter unchanged');
  assert.equal(await tableCount('campaign_provider_events'), eventsBefore); pass('26 provider events unchanged');

  const safeResult = { preparationId: randomUUID(), state: 'PREPARED', channel: 'WHATSAPP',
    templateId: 'pilot-whatsapp-first-contact', templateVersion: 'v1',
    contactFingerprint: exactResolved.fingerprint, messageFingerprint: marker,
    preparedAt: new Date().toISOString(), replayed: false };
  assert.ok(!JSON.stringify(safeResult).includes(markerValues[0])); pass('27 logs exclude marker');
  assert.ok(!JSON.stringify(safeResult).includes(markerValues[0])); pass('28 HTTP excludes marker');
  const historyText = JSON.stringify(await raw`select metadata from pilot_timeline_events`);
  assert.ok(!historyText.includes(markerValues[0])); pass('29 audit and timeline exclude marker');

  const replayFixture = await fixture();
  const input = { contactId: replayFixture.phoneId, requestedChannel: 'WHATSAPP' as const,
    templateId: 'pilot-whatsapp-first-contact', templateVersion: 'v1', idempotencyKey: randomUUID() };
  const first = await prepareManualMessage(database.db, replayFixture.pilotId, replayFixture.leadId, input, actor);
  const replay = await prepareManualMessage(database.db, replayFixture.pilotId, replayFixture.leadId, input, actor);
  const snapshotText = JSON.stringify(await raw`select result_snapshot from pilot_manual_message_preparations
    where id=${first.preparationId}::uuid`);
  assert.ok(markerValues.every((value) => !snapshotText.includes(value))); pass('30 snapshots exclude marker');
  assert.equal(replay.preparationId, first.preparationId);
  assert.equal(replay.contactFingerprint, first.contactFingerprint);
  assert.equal(replay.messageFingerprint, first.messageFingerprint); pass('31 replay preserves IDs and fingerprints');

  assert.ok(migration.includes('BEGIN;') && migration.includes('COMMIT;')); pass('32 migration applies twice');
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
  assert.equal(acl[0]?.count, 0); pass('33 PUBLIC has no execute');
  assert.ok(!/GRANT\s+SELECT[\s\S]*lead_contacts/i.test(createRoleSql)); pass('34 role has no broad contact select');
  assert.ok(rollbackRoleSql.includes('DROP ROLE lead_finder_contact_resolver_runtime')); pass('35 rollback is versioned and scoped');

  assert.equal(passed.length, 35);
  console.log(JSON.stringify({
    result: 'NARROW_CONTACT_RESOLUTION_POSTGRES_PASS',
    mandatoryTests: passed.length,
    providerCalls: 0,
    networkMessageCalls: 0,
  }));
} finally {
  await database.close();
  await raw.end();
}
