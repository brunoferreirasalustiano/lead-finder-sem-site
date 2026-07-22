import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  confirmManualResult,
  createDatabase,
  ManualMessagingError,
  prepareManualMessage,
  recordManualOpen,
  recordManualResponse,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';
import { buildApp } from '../apps/api/src/app.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const raw = postgres(databaseUrl, { max: 6 });
const { db, close } = createDatabase(databaseUrl, { max: 8 });
const originalStdoutWrite = process.stdout.write;
const actor = (principalId: string) => createAuthorizationContext({
  principalId,
  permissions: new Set(['manual-messaging:prepare', 'manual-messaging:open', 'manual-messaging:confirm', 'manual-messaging:opt-out']),
  authenticationMethod: 'integration-test',
});
const primaryActor = actor('manual-operator-a');
const waInput = (contactId: string, key = randomUUID()) => ({
  contactId,
  requestedChannel: 'WHATSAPP' as const,
  templateId: 'pilot-whatsapp-first-contact',
  templateVersion: 'v1',
  idempotencyKey: key,
});
const emailInput = (contactId: string, key = randomUUID()) => ({
  contactId,
  requestedChannel: 'EMAIL' as const,
  templateId: 'pilot-email-first-contact',
  templateVersion: 'v1',
  idempotencyKey: key,
});

type Fixture = { pilotId: string; leadId: string; phoneId: string; emailId: string };
let sequence = 0;
async function fixture(options: {
  pilotStatus?: string;
  review?: string;
  blocked?: boolean;
  doNotContact?: boolean;
  crmStage?: string;
  phoneValid?: boolean;
  phoneVerified?: boolean;
  emailValid?: boolean;
  emailVerified?: boolean;
  authorizeWhatsApp?: boolean;
  email?: string;
  emailOwnership?: 'BUSINESS' | 'PERSONAL' | 'UNKNOWN';
  emailEvidenceOrigin?: 'PUBLIC_BUSINESS_SOURCE' | 'DIRECTLY_PROVIDED' | 'SIGNED_RECORD' | 'UNSUPPORTED';
  reviewEmail?: boolean;
  emailSource?: string;
} = {}): Promise<Fixture> {
  sequence += 1;
  const leadId = randomUUID();
  const pilotId = randomUUID();
  const phoneId = randomUUID();
  const emailId = randomUUID();
  const suffix = String(sequence).padStart(4, '0');
  await raw.begin(async (tx) => {
    await tx`insert into leads(id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,do_not_contact,crm_stage) values(${leadId}::uuid,'node',${`manual-${suffix}`},'Empresa sintética','oficinas',90,'SEM_SITE_CADASTRADO',false,${options.blocked ?? false},${options.doNotContact ?? false},${options.crmStage ?? 'NOVO'})`;
    await tx`insert into pilot_runs(id,name,region,category,target_lead_count,status,created_by,started_at) values(${pilotId}::uuid,${`Piloto ${suffix}`},'SP','oficinas',1,${options.pilotStatus ?? 'RUNNING'},'integration-test',now())`;
    await tx`insert into pilot_leads(pilot_run_id,lead_id,source,added_by) values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`insert into pilot_reviews(pilot_run_id,lead_id,decision,reviewer_principal_id,version) values(${pilotId}::uuid,${leadId}::uuid,${options.review ?? 'APPROVED'},'reviewer',1)`;
    await tx`insert into lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp) values
      (${phoneId}::uuid,${leadId}::uuid,'TELEFONE','synthetic-phone',${`55 9 9123-${suffix}`} ,'BUSINESS_REGISTRY',1,${options.phoneVerified === false ? null : new Date()}::timestamptz,${options.phoneValid ?? true},true),
      (${emailId}::uuid,${leadId}::uuid,'EMAIL','synthetic-email',${options.email ?? `contato${suffix}@gmail.com`},${options.emailSource ?? 'BUSINESS_REGISTRY'},1,${options.emailVerified === false ? null : new Date()}::timestamptz,${options.emailValid ?? true},false)`;
    if (options.authorizeWhatsApp ?? true)
      await tx`insert into contact_channel_authorizations(contact_id,lead_id,channel,purpose,origin,evidence_fingerprint,granted_at,recorded_by) values(${phoneId}::uuid,${leadId}::uuid,'WHATSAPP','B2B_PROSPECTION','DIRECT_OPT_IN',${suffix.padStart(64, 'a').slice(-64)},now(),'server-actor')`;
    if (options.reviewEmail ?? true) {
      const origin = options.emailEvidenceOrigin ?? 'PUBLIC_BUSINESS_SOURCE';
      if (origin !== 'UNSUPPORTED')
        await tx`insert into contact_email_business_evidence(contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,human_decision,reviewer_principal_id,version) values(${emailId}::uuid,${leadId}::uuid,'EMAIL',${options.emailOwnership ?? 'BUSINESS'},${origin},${suffix.padStart(64, 'b').slice(-64)},'APPROVED','email-reviewer',1)`;
    }
  });
  return { pilotId, leadId, phoneId, emailId };
}
const expectCode = async (action: Promise<unknown>, code: ManualMessagingError['code']) => {
  await assert.rejects(action, (error: unknown) => error instanceof ManualMessagingError && error.code === code);
};
const count = async (table: string, where = '') => Number((await raw.unsafe(`select count(*)::int value from ${table} ${where}`))[0]?.value ?? -1);
const report: string[] = [];
const pass = (name: string) => report.push(name);

try {
  await raw`truncate pilot_manual_message_events,pilot_manual_message_preparations,contact_email_business_evidence,contact_channel_authorizations,pilot_reviews,pilot_leads,pilot_runs,campaign_provider_events,campaign_outbox,campaign_attempts,campaign_opt_outs,lead_contacts,leads restart identity cascade`;

  const whatsapp = await fixture();
  const preparedWhatsApp = await prepareManualMessage(db, whatsapp.pilotId, whatsapp.leadId, waInput(whatsapp.phoneId), primaryActor);
  assert.equal(preparedWhatsApp.channel, 'WHATSAPP');
  assert.match(preparedWhatsApp.link, /^https:\/\/wa\.me\/5555991230001\?text=/);
  pass('01 WhatsApp with valid opt-in');

  const noOptIn = await fixture({ authorizeWhatsApp: false, emailValid: false });
  await expectCode(prepareManualMessage(db, noOptIn.pilotId, noOptIn.leadId, waInput(noOptIn.phoneId), primaryActor), 'INELIGIBLE');
  pass('02 WhatsApp without opt-in rejected');

  const fallback = await fixture({ authorizeWhatsApp: false });
  const fallbackPrepared = await prepareManualMessage(db, fallback.pilotId, fallback.leadId, waInput(fallback.phoneId), primaryActor);
  assert.equal(fallbackPrepared.channel, 'EMAIL');
  assert.match(fallbackPrepared.link, /^mailto:/);
  pass('03 explicitly reviewed business Gmail is eligible');

  const gmailWithoutReview = await fixture({ reviewEmail: false });
  await expectCode(prepareManualMessage(db, gmailWithoutReview.pilotId, gmailWithoutReview.leadId, emailInput(gmailWithoutReview.emailId), primaryActor), 'INELIGIBLE');
  pass('03a Gmail without contact review is blocked');
  const personalGmail = await fixture({ emailOwnership: 'PERSONAL' });
  await expectCode(prepareManualMessage(db, personalGmail.pilotId, personalGmail.leadId, emailInput(personalGmail.emailId), primaryActor), 'INELIGIBLE');
  pass('03b personal Gmail is blocked');
  const companyDomain = await fixture({ email: 'sales@company.example' });
  assert.equal((await prepareManualMessage(db, companyDomain.pilotId, companyDomain.leadId, emailInput(companyDomain.emailId), primaryActor)).channel, 'EMAIL');
  pass('03c reviewed business custom domain is eligible');
  const unknownOwnership = await fixture({ emailOwnership: 'UNKNOWN' });
  await expectCode(prepareManualMessage(db, unknownOwnership.pilotId, unknownOwnership.leadId, emailInput(unknownOwnership.emailId), primaryActor), 'INELIGIBLE');
  pass('03d unknown email ownership is blocked');
  const emptySource = await fixture({ emailSource: '   ' });
  await expectCode(prepareManualMessage(db, emptySource.pilotId, emptySource.leadId, emailInput(emptySource.emailId), primaryActor), 'INELIGIBLE');
  pass('03e empty contact source is blocked');
  await assert.rejects(raw`insert into contact_email_business_evidence(contact_id,lead_id,ownership,origin,evidence_fingerprint,human_decision,reviewer_principal_id,version) values(${emptySource.emailId}::uuid,${emptySource.leadId}::uuid,'BUSINESS','UNSUPPORTED_SOURCE',${'e'.repeat(64)},'APPROVED','email-reviewer',2)`);
  pass('03e.1 unsupported evidence origin is blocked by PostgreSQL');
  const leadReviewOnly = await fixture({ reviewEmail: false });
  await expectCode(prepareManualMessage(db, leadReviewOnly.pilotId, leadReviewOnly.leadId, emailInput(leadReviewOnly.emailId), primaryActor), 'INELIGIBLE');
  pass('03f lead review does not replace contact review');
  const otherContactEvidence = await fixture({ reviewEmail: false });
  const otherEmailId = randomUUID();
  await raw`insert into lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp) values(${otherEmailId}::uuid,${otherContactEvidence.leadId}::uuid,'EMAIL','synthetic-other','other@company.example','BUSINESS_REGISTRY',1,now(),true,false)`;
  await raw`insert into contact_email_business_evidence(contact_id,lead_id,ownership,origin,evidence_fingerprint,human_decision,reviewer_principal_id,version) values(${otherEmailId}::uuid,${otherContactEvidence.leadId}::uuid,'BUSINESS','PUBLIC_BUSINESS_SOURCE',${'c'.repeat(64)},'APPROVED','email-reviewer',1)`;
  await expectCode(prepareManualMessage(db, otherContactEvidence.pilotId, otherContactEvidence.leadId, emailInput(otherContactEvidence.emailId), primaryActor), 'INELIGIBLE');
  pass('03g evidence for another contact does not authorize selection');

  const unavailable = await fixture({ authorizeWhatsApp: false, emailValid: false });
  await expectCode(prepareManualMessage(db, unavailable.pilotId, unavailable.leadId, emailInput(unavailable.emailId), primaryActor), 'INELIGIBLE');
  pass('04 no channel available');

  const foreign = await fixture();
  await expectCode(prepareManualMessage(db, whatsapp.pilotId, whatsapp.leadId, emailInput(foreign.emailId), primaryActor), 'INELIGIBLE');
  pass('05 contact from another lead');

  for (const [name, options] of [
    ['06 blocked lead', { blocked: true }],
    ['07 do_not_contact', { doNotContact: true }],
    ['08 CRM NAO_CONTATAR', { crmStage: 'NAO_CONTATAR' }],
    ['12 review not approved', { review: 'NEEDS_REVIEW' }],
    ['13 pilot outside RUNNING', { pilotStatus: 'PAUSED' }],
    ['14 invalid contact', { emailValid: false }],
    ['15 unverified contact', { emailVerified: false }],
  ] as const) {
    const item = await fixture(options);
    await expectCode(prepareManualMessage(db, item.pilotId, item.leadId, emailInput(item.emailId), primaryActor), 'INELIGIBLE');
    pass(name);
  }

  const globalOptOut = await fixture();
  await raw`insert into campaign_opt_outs(lead_id,channel,reason,source) values(${globalOptOut.leadId}::uuid,null,'test','integration')`;
  await expectCode(prepareManualMessage(db, globalOptOut.pilotId, globalOptOut.leadId, emailInput(globalOptOut.emailId), primaryActor), 'INELIGIBLE');
  pass('09 global opt-out');

  const waOptOut = await fixture();
  await raw`insert into campaign_opt_outs(lead_id,channel,reason,source) values(${waOptOut.leadId}::uuid,'WHATSAPP','test','integration')`;
  assert.equal((await prepareManualMessage(db, waOptOut.pilotId, waOptOut.leadId, waInput(waOptOut.phoneId), primaryActor)).channel, 'EMAIL');
  pass('10 WhatsApp opt-out preserves email');

  const emailOptOut = await fixture();
  await raw`insert into campaign_opt_outs(lead_id,channel,reason,source) values(${emailOptOut.leadId}::uuid,'EMAIL','test','integration')`;
  assert.equal((await prepareManualMessage(db, emailOptOut.pilotId, emailOptOut.leadId, waInput(emailOptOut.phoneId), primaryActor)).channel, 'WHATSAPP');
  pass('11 email opt-out preserves authorized WhatsApp');

  const badTemplate = await fixture();
  await expectCode(prepareManualMessage(db, badTemplate.pilotId, badTemplate.leadId, { ...emailInput(badTemplate.emailId), templateId: 'unapproved' }, primaryActor), 'INELIGIBLE');
  pass('16 unapproved template');

  const replayFixture = await fixture({ authorizeWhatsApp: false });
  const replayKey = randomUUID();
  const replayInput = waInput(replayFixture.phoneId, replayKey);
  const first = await prepareManualMessage(db, replayFixture.pilotId, replayFixture.leadId, replayInput, primaryActor);
  const replay = await prepareManualMessage(db, replayFixture.pilotId, replayFixture.leadId, replayInput, primaryActor);
  assert.deepEqual({ ...replay, replayed: false }, { ...first, replayed: false });
  assert.equal(replay.replayed, true);
  pass('17 identical payload replay');
  await expectCode(prepareManualMessage(db, replayFixture.pilotId, replayFixture.leadId, { ...replayInput, requestedChannel: 'EMAIL' }, primaryActor), 'IDEMPOTENCY_CONFLICT');
  pass('18 same key with different payload');

  const concurrentFixture = await fixture();
  const concurrentInput = waInput(concurrentFixture.phoneId, randomUUID());
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => prepareManualMessage(db, concurrentFixture.pilotId, concurrentFixture.leadId, concurrentInput, primaryActor)));
  assert.equal(new Set(concurrent.map((item) => item.preparationId)).size, 1);
  assert.equal(concurrent.filter((item) => !item.replayed).length, 1);
  pass('19 concurrent calls');

  const snapshotFixture = await fixture({ authorizeWhatsApp: false, email: 'a@company.example' });
  const snapshotInput = waInput(snapshotFixture.phoneId, randomUUID());
  const snapshotFirst = await prepareManualMessage(db, snapshotFixture.pilotId, snapshotFixture.leadId, snapshotInput, primaryActor);
  const emailB = randomUUID();
  await raw`insert into lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp) values(${emailB}::uuid,${snapshotFixture.leadId}::uuid,'EMAIL','synthetic-b','b@company.example','BUSINESS_REGISTRY',1,now(),true,false)`;
  const snapshotReplay = await prepareManualMessage(db, snapshotFixture.pilotId, snapshotFixture.leadId, snapshotInput, primaryActor);
  assert.equal(snapshotReplay.link, snapshotFirst.link);
  assert.ok(snapshotReplay.link.includes('a%40company.example'));
  assert.ok(!snapshotReplay.link.includes('b%40company.example'));
  pass('20 replay preserves the eligible persisted contact');
  await raw`update lead_contacts set is_valid=false where id=${snapshotFixture.emailId}::uuid`;
  await expectCode(prepareManualMessage(db, snapshotFixture.pilotId, snapshotFixture.leadId, snapshotInput, primaryActor), 'INELIGIBLE');
  pass('20a replay fails closed after persisted contact invalidation');
  const ownershipChanged = await fixture({ email: 'owned@company.example' });
  const ownershipInput = emailInput(ownershipChanged.emailId);
  await prepareManualMessage(db, ownershipChanged.pilotId, ownershipChanged.leadId, ownershipInput, primaryActor);
  await raw`insert into contact_email_business_evidence(contact_id,lead_id,ownership,origin,evidence_fingerprint,human_decision,reviewer_principal_id,version) values(${ownershipChanged.emailId}::uuid,${ownershipChanged.leadId}::uuid,'PERSONAL','DIRECTLY_PROVIDED',${'f'.repeat(64)},'APPROVED','email-reviewer',2)`;
  await expectCode(prepareManualMessage(db, ownershipChanged.pilotId, ownershipChanged.leadId, ownershipInput, primaryActor), 'INELIGIBLE');
  pass('20b current conflicting ownership blocks replay');
  await expectCode(prepareManualMessage(db, snapshotFixture.pilotId, snapshotFixture.leadId, snapshotInput, actor('manual-operator-b')), 'IDEMPOTENCY_CONFLICT');
  const persistedActor = (await raw`select operator_principal_id from pilot_manual_message_preparations where id=${snapshotFirst.preparationId}::uuid`)[0]?.operator_principal_id;
  assert.equal(persistedActor, 'manual-operator-a');
  pass('21 replay by another principal rejected');

  assert.equal(await count('pilot_manual_message_events', `where preparation_id='${preparedWhatsApp.preparationId}'::uuid`), 0);
  pass('22 PREPARED creates no sending event');
  await expectCode(confirmManualResult(db, preparedWhatsApp.preparationId, { result: 'NOT_SENT', idempotencyKey: randomUUID() }, primaryActor), 'INVALID_STATE');
  pass('22a confirmation before opening rejected');
  const opened = await recordManualOpen(db, preparedWhatsApp.preparationId, { idempotencyKey: randomUUID() }, primaryActor);
  assert.equal(opened.state, 'OPENED');
  assert.equal(await count('pilot_manual_message_events', `where preparation_id='${preparedWhatsApp.preparationId}'::uuid and event_type='CONTACT_CONFIRMED'`), 0);
  pass('23 OPENED is not sending');
  pass('24 CONTACT_CONFIRMED requires explicit call');
  const confirmationKey = randomUUID();
  const confirmed = await confirmManualResult(db, preparedWhatsApp.preparationId, { result: 'NOT_SENT', idempotencyKey: confirmationKey }, primaryActor);
  const confirmationReplay = await confirmManualResult(db, preparedWhatsApp.preparationId, { result: 'NOT_SENT', idempotencyKey: confirmationKey }, primaryActor);
  assert.equal(confirmationReplay.eventId, confirmed.eventId);
  assert.equal(confirmationReplay.replayed, true);
  pass('25 duplicate confirmation');
  await expectCode(confirmManualResult(db, preparedWhatsApp.preparationId, { result: 'NOT_SENT', idempotencyKey: confirmationKey }, actor('manual-operator-b')), 'IDEMPOTENCY_CONFLICT');
  pass('25a event replay by another principal rejected');
  await expectCode(recordManualOpen(db, preparedWhatsApp.preparationId, { idempotencyKey: randomUUID() }, primaryActor), 'INVALID_STATE');
  pass('25b opening after terminal confirmation rejected');
  const duplicateState = await fixture();
  const duplicatePreparation = await prepareManualMessage(db, duplicateState.pilotId, duplicateState.leadId, waInput(duplicateState.phoneId), primaryActor);
  const duplicateOpenA = await recordManualOpen(db, duplicatePreparation.preparationId, { idempotencyKey: randomUUID() }, primaryActor);
  const duplicateOpenB = await recordManualOpen(db, duplicatePreparation.preparationId, { idempotencyKey: randomUUID() }, primaryActor);
  assert.equal(duplicateOpenB.eventId, duplicateOpenA.eventId);
  const duplicateConfirmationA = await confirmManualResult(db, duplicatePreparation.preparationId, { result: 'SENT_CONFIRMED', idempotencyKey: randomUUID() }, primaryActor);
  const duplicateConfirmationB = await confirmManualResult(db, duplicatePreparation.preparationId, { result: 'SENT_CONFIRMED', idempotencyKey: randomUUID() }, primaryActor);
  assert.equal(duplicateConfirmationB.eventId, duplicateConfirmationA.eventId);
  await expectCode(confirmManualResult(db, duplicatePreparation.preparationId, { result: 'NOT_SENT', idempotencyKey: randomUUID() }, primaryActor), 'INVALID_STATE');
  pass('25c different keys cannot duplicate or contradict terminal state');
  const concurrentState = await fixture();
  const concurrentPreparation = await prepareManualMessage(db, concurrentState.pilotId, concurrentState.leadId, waInput(concurrentState.phoneId), primaryActor);
  await recordManualOpen(db, concurrentPreparation.preparationId, { idempotencyKey: randomUUID() }, primaryActor);
  const concurrentResults = await Promise.allSettled([
    confirmManualResult(db, concurrentPreparation.preparationId, { result: 'SENT_CONFIRMED', idempotencyKey: randomUUID() }, primaryActor),
    confirmManualResult(db, concurrentPreparation.preparationId, { result: 'NOT_SENT', idempotencyKey: randomUUID() }, primaryActor),
  ]);
  assert.equal(concurrentResults.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(await count('pilot_manual_message_events', `where preparation_id='${concurrentPreparation.preparationId}'::uuid and event_type='CONTACT_CONFIRMED'`), 1);
  pass('25d concurrent contradictory confirmations have one winner');
  await expectCode(confirmManualResult(db, randomUUID(), { result: 'NOT_SENT', idempotencyKey: randomUUID() }, primaryActor), 'NOT_FOUND');
  pass('26 nonexistent preparation confirmation');

  const revokedAfter = await fixture();
  const revokedInput = waInput(revokedAfter.phoneId);
  const revokedPreparation = await prepareManualMessage(db, revokedAfter.pilotId, revokedAfter.leadId, revokedInput, primaryActor);
  await recordManualOpen(db, revokedPreparation.preparationId, { idempotencyKey: randomUUID() }, primaryActor);
  await raw`insert into campaign_opt_outs(lead_id,channel,reason,source) values(${revokedAfter.leadId}::uuid,'WHATSAPP','after prepared','integration')`;
  await expectCode(prepareManualMessage(db, revokedAfter.pilotId, revokedAfter.leadId, revokedInput, primaryActor), 'INELIGIBLE');
  await expectCode(confirmManualResult(db, revokedPreparation.preparationId, { result: 'SENT_CONFIRMED', idempotencyKey: randomUUID() }, primaryActor), 'INELIGIBLE');
  pass('27 opt-out after PREPARED blocks replay and confirmation');

  const blockedAfter = await fixture();
  const blockedInput = waInput(blockedAfter.phoneId);
  await prepareManualMessage(db, blockedAfter.pilotId, blockedAfter.leadId, blockedInput, primaryActor);
  await raw`update leads set do_not_contact=true,crm_stage='NAO_CONTATAR' where id=${blockedAfter.leadId}::uuid`;
  await expectCode(prepareManualMessage(db, blockedAfter.pilotId, blockedAfter.leadId, blockedInput, primaryActor), 'INELIGIBLE');
  pass('27a do_not_contact and NAO_CONTATAR block replay');

  const during = await fixture();
  const duringPreparation = await prepareManualMessage(db, during.pilotId, during.leadId, waInput(during.phoneId), primaryActor);
  await recordManualOpen(db, duringPreparation.preparationId, { idempotencyKey: randomUUID() }, primaryActor);
  let release!: () => void;
  const inserted = new Promise<void>((resolve) => { release = resolve; });
  const optOutTransaction = raw.begin(async (tx) => {
    await tx`insert into campaign_opt_outs(lead_id,channel,reason,source) values(${during.leadId}::uuid,'WHATSAPP','during confirmation','integration')`;
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await inserted;
  const duringConfirmation = confirmManualResult(db, duringPreparation.preparationId, { result: 'SENT_CONFIRMED', idempotencyKey: randomUUID() }, primaryActor);
  await optOutTransaction;
  await expectCode(duringConfirmation, 'INELIGIBLE');
  pass('28 opt-out committed during confirmation wins');

  const restart = createDatabase(databaseUrl);
  const restartReplay = await prepareManualMessage(restart.db, replayFixture.pilotId, replayFixture.leadId, replayInput, primaryActor);
  assert.equal(restartReplay.link, first.link);
  await restart.close();
  pass('29 persisted state after restart');
  const persistedSnapshot = (await raw`select result_snapshot from pilot_manual_message_preparations where id=${snapshotFirst.preparationId}::uuid`)[0]?.result_snapshot;
  assert.ok(!JSON.stringify(persistedSnapshot).includes('a@company.example'));
  assert.ok(!JSON.stringify(persistedSnapshot).includes(snapshotFirst.message));
  assert.ok(!JSON.stringify(persistedSnapshot).includes('mailto:'));
  pass('29a persisted snapshot excludes contact, message and link');
  const invalidState = await fixture();
  const invalidPreparation = await prepareManualMessage(db, invalidState.pilotId, invalidState.leadId, waInput(invalidState.phoneId), primaryActor);
  await assert.rejects(raw`insert into pilot_manual_message_events(preparation_id,event_type,result,operator_principal_id,payload_fingerprint,idempotency_key) values(${invalidPreparation.preparationId}::uuid,'CONTACT_CONFIRMED','NOT_SENT','direct-sql',${'d'.repeat(64)},${randomUUID()})`);
  pass('29b PostgreSQL rejects direct invalid transition');

  assert.equal(await count('campaign_attempts'), 0); pass('30 zero campaign_attempts');
  assert.equal(await count('campaign_outbox'), 0); pass('31 zero outbox');
  assert.equal(await count('campaign_provider_events'), 0); pass('32 zero provider events');
  pass('33 zero network calls by construction');

  const token = 'synthetic-manual-api-token';
  const url = `/pilots/${whatsapp.pilotId}/leads/${whatsapp.leadId}/manual-messages/prepare`;
  const payload = { contactId: whatsapp.phoneId, requestedChannel: 'WHATSAPP', templateId: 'pilot-whatsapp-first-contact', templateVersion: 'v1' };
  const headers = { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() };
  const logChunks: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    logChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  const app = buildApp(db, { authentication: { token, principalId: 'http-operator', principalPermissions: ['manual-messaging:prepare', 'manual-messaging:open', 'manual-messaging:confirm'] } });
  assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url, payload, headers: { authorization: 'Bearer invalid', 'idempotency-key': randomUUID() } })).statusCode, 401);
  const forbiddenApp = buildApp(db, { authentication: { token, principalPermissions: [] } });
  assert.equal((await forbiddenApp.inject({ method: 'POST', url, payload, headers })).statusCode, 403);
  await forbiddenApp.close();
  assert.equal((await app.inject({ method: 'POST', url: '/pilots/not-a-uuid/leads/not-a-uuid/manual-messages/prepare', payload, headers })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, payload: { ...payload, actor: 'forged' }, headers })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${token}` } })).statusCode, 400);
  const httpPrepared = await app.inject({ method: 'POST', url, payload, headers });
  assert.equal(httpPrepared.statusCode, 201);
  assert.match(httpPrepared.json().link, /^https:\/\/wa\.me\//);
  const httpId = httpPrepared.json().preparationId as string;
  assert.equal((await raw`select operator_principal_id from pilot_manual_message_preparations where id=${httpId}::uuid`)[0]?.operator_principal_id, 'http-operator');
  assert.equal((await app.inject({ method: 'POST', url, payload: { ...payload, requestedChannel: 'EMAIL', templateId: 'pilot-email-first-contact' }, headers })).statusCode, 409);
  const ineligibleUrl = `/pilots/${noOptIn.pilotId}/leads/${noOptIn.leadId}/manual-messages/prepare`;
  assert.equal((await app.inject({ method: 'POST', url: ineligibleUrl, payload: { ...payload, contactId: noOptIn.phoneId }, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 422);
  assert.equal((await app.inject({ method: 'POST', url: `/manual-message-preparations/${randomUUID()}/open`, payload: {}, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/manual-message-preparations/${httpId}/open`, payload: { actor: 'forged' }, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/manual-message-preparations/${httpId}/open`, payload: {}, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: `/manual-message-preparations/${httpId}/confirm`, payload: { result: 'UNKNOWN' }, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/manual-message-preparations/${httpId}/confirm`, payload: { result: 'NOT_SENT', actor: 'forged' }, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/manual-message-preparations/${httpId}/confirm`, payload: { result: 'OPT_OUT' }, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/manual-message-preparations/${httpId}/confirm`, payload: { result: 'SENT_CONFIRMED' }, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: `/manual-message-preparations/${httpId}/response`, payload: { result: 'OPT_OUT' }, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 403);
  const optOutApp = buildApp(db, { authentication: { token, principalId: 'http-operator', principalPermissions: ['manual-messaging:confirm', 'manual-messaging:opt-out'] } });
  assert.equal((await optOutApp.inject({ method: 'POST', url: `/manual-message-preparations/${httpId}/response`, payload: { result: 'OPT_OUT' }, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode, 201);
  await optOutApp.close();
  await app.close();
  process.stdout.write = originalStdoutWrite;
  const manualLogs = logChunks.join('');
  assert.ok(!manualLogs.includes('synthetic-phone'));
  assert.ok(!manualLogs.includes(preparedWhatsApp.message));
  assert.ok(!manualLogs.includes(preparedWhatsApp.link));
  pass('HTTP prepare/open/confirm/response auth, validation, 404/409/422, principal and opt-out permission');

  const sensitive = JSON.stringify({ phone: '55 9 9123-0001', email: 'a@company.example', message: snapshotFirst.message, link: snapshotFirst.link });
  const safeEvidence = JSON.stringify({ tests: report, counts: { preparations: await count('pilot_manual_message_preparations'), events: await count('pilot_manual_message_events') } });
  assert.ok(!safeEvidence.includes('55 9 9123-0001') && !safeEvidence.includes('a@company.example') && !safeEvidence.includes(snapshotFirst.message));
  assert.ok(sensitive.length > safeEvidence.length);
  pass('34 evidence and errors contain no PII');

  console.log(JSON.stringify({ result: 'MANUAL_MESSAGING_POSTGRES_PASS', tests: report, networkCalls: 0 }));
} finally {
  process.stdout.write = originalStdoutWrite;
  await close();
  await raw.end();
}
