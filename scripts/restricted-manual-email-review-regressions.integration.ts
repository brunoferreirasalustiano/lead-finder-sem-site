import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  createDatabase,
  prepareManualMessage,
  recordManualOpen,
  sendPreparedManualEmail,
} from '@lead-finder/database';
import {
  approvedTemplates,
  DeterministicFakeMessagingProvider,
} from '@lead-finder/messaging';
import { createAuthorizationContext } from '@lead-finder/shared';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const raw = postgres(databaseUrl, { max: 6 });
const { db, close } = createDatabase(databaseUrl, { max: 8 });
const provider = new DeterministicFakeMessagingProvider();

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const legacyContactFingerprint = (contactId: string, value: string) => digest({
  channel: 'EMAIL',
  contactId,
  value,
});

const auth = createAuthorizationContext({
  principalId: 'restricted-email-review-regression-operator',
  permissions: new Set([
    'manual-messaging:prepare',
    'manual-messaging:open',
    'manual-messaging:send',
  ]),
  authenticationMethod: 'integration-test',
});

let sequence = 0;
const fixture = async () => {
  sequence += 1;
  const suffix = String(sequence).padStart(4, '0');
  const leadId = randomUUID();
  const pilotId = randomUUID();
  const emailId = randomUUID();
  const email = `review-regression-${suffix}@example.test`;
  const leadName = `Empresa review ${suffix}`;
  const source = 'PUBLIC_BUSINESS_SOURCE';

  await raw.begin(async (tx) => {
    await tx`
      insert into leads(
        id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,
        do_not_contact,crm_stage
      ) values(
        ${leadId}::uuid,'node',${`review-regression-${suffix}`},${leadName},
        'saloes',90,'SEM_SITE_CADASTRADO',false,false,false,'NOVO'
      )`;
    await tx`
      insert into pilot_runs(
        id,name,region,category,target_lead_count,status,created_by,started_at
      ) values(
        ${pilotId}::uuid,${`Piloto review ${suffix}`},'Campinas/SP','saloes',1,
        'RUNNING','integration-test',now()
      )`;
    await tx`
      insert into pilot_leads(pilot_run_id,lead_id,source,added_by)
      values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`
      insert into pilot_reviews(
        pilot_run_id,lead_id,decision,reviewer_principal_id,version
      ) values(${pilotId}::uuid,${leadId}::uuid,'APPROVED','reviewer',1)`;
    await tx`
      insert into lead_contacts(
        id,lead_id,type,original_value,normalized_value,source,confidence,
        verified_at,is_valid,possible_whatsapp
      ) values(
        ${emailId}::uuid,${leadId}::uuid,'EMAIL','synthetic-email',${email},
        ${source},1,now(),true,false
      )`;
    await tx`
      insert into contact_email_business_evidence(
        contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,
        human_decision,reviewer_principal_id,version
      ) values(
        ${emailId}::uuid,${leadId}::uuid,'EMAIL','BUSINESS',
        'PUBLIC_BUSINESS_SOURCE',${suffix.padStart(64, 'a').slice(-64)},
        'APPROVED','email-reviewer',1
      )`;
  });

  return { leadId, pilotId, emailId, email, leadName, source };
};

const emailInput = (contactId: string, version: 'v1' | 'v2', idempotencyKey: string) => ({
  contactId,
  requestedChannel: 'EMAIL' as const,
  templateId: 'pilot-email-first-contact',
  templateVersion: version,
  idempotencyKey,
});

try {
  await raw`
    truncate table
      pilot_manual_email_send_events,
      pilot_manual_email_send_attempts,
      pilot_manual_message_events,
      pilot_manual_message_preparations,
      contact_email_business_evidence,
      contact_channel_authorization_revocations,
      contact_channel_authorizations,
      pilot_reviews,
      pilot_leads,
      pilot_runs,
      campaign_opt_outs,
      lead_contacts,
      leads
    restart identity cascade`;

  const legacy = await fixture();
  const legacyKey = randomUUID();
  const variables = { EMPRESA: legacy.leadName, FONTE: legacy.source };
  const preparedMessage = provider.prepare(approvedTemplates.emailV1, variables);
  const legacySnapshot = {
    channel: 'EMAIL',
    templateId: approvedTemplates.emailV1.id,
    templateVersion: approvedTemplates.emailV1.version,
    variables,
    contactFingerprint: legacyContactFingerprint(legacy.emailId, legacy.email),
    messageFingerprint: preparedMessage.fingerprint,
  };
  const input = emailInput(legacy.emailId, 'v1', legacyKey);
  const payloadFingerprint = digest({
    pilotRunId: legacy.pilotId,
    leadId: legacy.leadId,
    ...input,
    principalId: auth.principalId,
  });
  const preparationId = randomUUID();

  await raw`
    insert into pilot_manual_message_preparations(
      id,pilot_run_id,lead_id,contact_id,channel,template_id,template_version,
      operator_principal_id,payload_fingerprint,idempotency_key,
      result_fingerprint,result_snapshot,expires_at
    ) values(
      ${preparationId}::uuid,${legacy.pilotId}::uuid,${legacy.leadId}::uuid,
      ${legacy.emailId}::uuid,'EMAIL',${approvedTemplates.emailV1.id},
      ${approvedTemplates.emailV1.version},${auth.principalId},
      ${payloadFingerprint},${legacyKey},${digest(legacySnapshot)},
      ${raw.json(legacySnapshot)},now()+interval '24 hours'
    )`;

  const replay = await prepareManualMessage(
    db,
    legacy.pilotId,
    legacy.leadId,
    input,
    auth,
  );
  assert.equal(replay.preparationId, preparationId);
  assert.equal(replay.replayed, true);

  const openedLegacy = await recordManualOpen(
    db,
    preparationId,
    { idempotencyKey: randomUUID() },
    auth,
  );
  assert.equal(openedLegacy.replayed, false);

  let providerCalls = 0;
  const deliveredLegacy = await sendPreparedManualEmail(
    db,
    preparationId,
    auth,
    {
      sendEnabled: true,
      killSwitchEnabled: false,
      sender: 'leadfinderbrasil@example.test',
      fingerprintKey: 'restricted-manual-email-review-regression-key',
      deliver: async (message) => {
        providerCalls += 1;
        assert.equal(message.recipient, legacy.email);
        return { provider: 'GMAIL_API' as const, messageId: 'legacy-review-regression-message' };
      },
    },
  );
  assert.equal(deliveredLegacy.state, 'DELIVERED');
  assert.equal(providerCalls, 1);

  const replayFixture = await fixture();
  const replayPrepared = await prepareManualMessage(
    db,
    replayFixture.pilotId,
    replayFixture.leadId,
    emailInput(replayFixture.emailId, 'v2', randomUUID()),
    auth,
  );
  const firstOpen = await recordManualOpen(
    db,
    replayPrepared.preparationId,
    { idempotencyKey: randomUUID() },
    auth,
  );
  assert.equal(firstOpen.replayed, false);

  await raw`
    insert into campaign_opt_outs(lead_id,channel,reason,source)
    values(${replayFixture.leadId}::uuid,'EMAIL','synthetic-review-regression','integration')`;

  const replayedOpen = await recordManualOpen(
    db,
    replayPrepared.preparationId,
    { idempotencyKey: randomUUID() },
    auth,
  );
  assert.equal(replayedOpen.replayed, true);
  assert.equal(replayedOpen.eventId, firstOpen.eventId);

  await raw`
    update pilot_manual_message_preparations
    set expires_at=clock_timestamp()-interval '1 second'
    where id=${replayPrepared.preparationId}::uuid`;

  const replayedExpiredOpen = await recordManualOpen(
    db,
    replayPrepared.preparationId,
    { idempotencyKey: randomUUID() },
    auth,
  );
  assert.equal(replayedExpiredOpen.replayed, true);
  assert.equal(replayedExpiredOpen.eventId, firstOpen.eventId);

  console.log(JSON.stringify({
    result: 'RESTRICTED_MANUAL_EMAIL_REVIEW_REGRESSIONS_PASS',
    legacyPre0025ReplayOpenSend: true,
    openedReplayAfterOptOut: true,
    openedReplayAfterExpiry: true,
    providerCalls,
    realRecipients: 0,
    messagesSent: 0,
  }));
} finally {
  await close();
  await raw.end();
}
