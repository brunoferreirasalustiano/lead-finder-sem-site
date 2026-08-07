import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  createDatabase,
  prepareManualMessage,
  recordManualOpen,
} from '@lead-finder/database';
import {
  approvedTemplates,
  DeterministicFakeMessagingProvider,
} from '@lead-finder/messaging';
import { createAuthorizationContext } from '@lead-finder/shared';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const raw = postgres(databaseUrl, { max: 4 });
const { db, close } = createDatabase(databaseUrl, { max: 6 });
const fakeProvider = new DeterministicFakeMessagingProvider();

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

const auth = createAuthorizationContext({
  principalId: 'restricted-email-review-followup-operator',
  permissions: new Set([
    'manual-messaging:prepare',
    'manual-messaging:open',
    'manual-messaging:send',
  ]),
  authenticationMethod: 'integration-test',
});

const emailInput = (
  contactId: string,
  version: 'v1' | 'v2' = 'v2',
  idempotencyKey = randomUUID(),
) => ({
  contactId,
  requestedChannel: 'EMAIL' as const,
  templateId: approvedTemplates.emailV2.id,
  templateVersion: version,
  idempotencyKey,
});

type Fixture = Readonly<{
  pilotId: string;
  leadId: string;
  emailId: string;
  email: string;
  source: string;
  leadName: string;
}>;

let sequence = 0;
const fixture = async (): Promise<Fixture> => {
  sequence += 1;
  const suffix = String(sequence).padStart(4, '0');
  const leadId = randomUUID();
  const pilotId = randomUUID();
  const emailId = randomUUID();
  const email = `review-followup-${suffix}@example.test`;
  const source = 'PUBLIC_BUSINESS_SOURCE';
  const leadName = `Empresa replay ${suffix}`;

  await raw.begin(async (tx) => {
    await tx`
      insert into leads(
        id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,
        do_not_contact,crm_stage
      ) values (
        ${leadId}::uuid,'node',${`review-followup-${suffix}`},${leadName},
        'saloes',90,'SEM_SITE_CADASTRADO',false,false,false,'NOVO'
      )`;
    await tx`
      insert into pilot_runs(
        id,name,region,category,target_lead_count,status,created_by,started_at
      ) values (
        ${pilotId}::uuid,${`Piloto replay ${suffix}`},'Campinas/SP','saloes',1,
        'RUNNING','integration-test',now()
      )`;
    await tx`
      insert into pilot_leads(pilot_run_id,lead_id,source,added_by)
      values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`
      insert into pilot_reviews(
        pilot_run_id,lead_id,decision,reviewer_principal_id,version
      ) values(
        ${pilotId}::uuid,${leadId}::uuid,'APPROVED','reviewer',1
      )`;
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
        'PUBLIC_BUSINESS_SOURCE',${suffix.padStart(64, 'e').slice(-64)},
        'APPROVED','email-reviewer',1
      )`;
  });

  return { pilotId, leadId, emailId, email, source, leadName };
};

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

  // Genuine pre-0025 V1 snapshots contain the deterministic legacy contact
  // fingerprint, while the live contact now carries the opaque 0025 value.
  const historical = await fixture();
  const historicalKey = randomUUID();
  const historicalVariables = {
    EMPRESA: historical.leadName,
    FONTE: historical.source,
  };
  const historicalPrepared = fakeProvider.prepare(
    approvedTemplates.emailV1,
    historicalVariables,
  );
  const legacyContactFingerprint = digest({
    channel: 'EMAIL',
    contactId: historical.emailId,
    value: historical.email,
  });
  const historicalSnapshot = {
    channel: 'EMAIL',
    templateId: approvedTemplates.emailV1.id,
    templateVersion: approvedTemplates.emailV1.version,
    variables: historicalVariables,
    contactFingerprint: legacyContactFingerprint,
    messageFingerprint: historicalPrepared.fingerprint,
  };
  const historicalInput = emailInput(historical.emailId, 'v1', historicalKey);
  const historicalPayloadFingerprint = digest({
    pilotRunId: historical.pilotId,
    leadId: historical.leadId,
    ...historicalInput,
    principalId: auth.principalId,
  });
  const historicalPreparationId = randomUUID();

  await raw`
    insert into pilot_manual_message_preparations(
      id,pilot_run_id,lead_id,contact_id,channel,template_id,template_version,
      operator_principal_id,payload_fingerprint,idempotency_key,
      result_fingerprint,result_snapshot,expires_at
    ) values(
      ${historicalPreparationId}::uuid,${historical.pilotId}::uuid,
      ${historical.leadId}::uuid,${historical.emailId}::uuid,'EMAIL',
      ${approvedTemplates.emailV1.id},${approvedTemplates.emailV1.version},
      ${auth.principalId},${historicalPayloadFingerprint},${historicalKey},
      ${digest(historicalSnapshot)},${raw.json(historicalSnapshot)},
      now()+interval '24 hours'
    )`;

  const replayedPreparation = await prepareManualMessage(
    db,
    historical.pilotId,
    historical.leadId,
    historicalInput,
    auth,
  );
  assert.equal(replayedPreparation.preparationId, historicalPreparationId);
  assert.equal(replayedPreparation.replayed, true);

  const historicalOpen = await recordManualOpen(
    db,
    historicalPreparationId,
    { idempotencyKey: randomUUID() },
    auth,
  );
  assert.equal(historicalOpen.state, 'OPENED');
  assert.equal(historicalOpen.replayed, false);

  // Once OPENED is durable, a lost response must replay that transition even
  // if the lead becomes ineligible before the client retries with a new key.
  const live = await fixture();
  const prepared = await prepareManualMessage(
    db,
    live.pilotId,
    live.leadId,
    emailInput(live.emailId),
    auth,
  );
  const firstOpen = await recordManualOpen(
    db,
    prepared.preparationId,
    { idempotencyKey: randomUUID() },
    auth,
  );
  assert.equal(firstOpen.replayed, false);

  await raw`
    insert into campaign_opt_outs(lead_id,channel,reason,source)
    values(${live.leadId}::uuid,'EMAIL','synthetic-after-open','integration')`;

  const replayedOpen = await recordManualOpen(
    db,
    prepared.preparationId,
    { idempotencyKey: randomUUID() },
    auth,
  );
  assert.equal(replayedOpen.eventId, firstOpen.eventId);
  assert.equal(replayedOpen.replayed, true);

  console.log('RESTRICTED_MANUAL_EMAIL_REVIEW_FOLLOWUPS=PASS');
} finally {
  await raw.end();
  await close();
}
