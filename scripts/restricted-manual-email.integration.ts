import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  createDatabase,
  ManualMessagingError,
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
const raw = postgres(databaseUrl, { max: 8 });
const { db, close } = createDatabase(databaseUrl, { max: 12 });
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

const legacyV1ContactFingerprint = (contactId: string, contactValue: string) =>
  createHash('sha256')
    .update(JSON.stringify({ channel: 'EMAIL', contactId, value: contactValue }))
    .digest('hex');

const actor = (principalId: string) => createAuthorizationContext({
  principalId,
  permissions: new Set([
    'manual-messaging:prepare',
    'manual-messaging:open',
    'manual-messaging:send',
  ]),
  authenticationMethod: 'integration-test',
});
const primaryActor = actor('restricted-email-operator-a');
const secondaryActor = actor('restricted-email-operator-b');

const emailInput = (
  contactId: string,
  version: 'v1' | 'v2' = 'v2',
  idempotencyKey = randomUUID(),
) => ({
  contactId,
  requestedChannel: 'EMAIL' as const,
  templateId: 'pilot-email-first-contact',
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
const fixture = async (options: {
  ownership?: 'BUSINESS' | 'PERSONAL' | 'UNKNOWN';
  humanDecision?: 'APPROVED' | 'REJECTED';
  optOut?: boolean;
  blocked?: boolean;
  doNotContact?: boolean;
  crmStage?: string;
  pilotStatus?: string;
  review?: string;
} = {}): Promise<Fixture> => {
  sequence += 1;
  const suffix = String(sequence).padStart(4, '0');
  const leadId = randomUUID();
  const pilotId = randomUUID();
  const emailId = randomUUID();
  const email = `synthetic-${suffix}@example.test`;
  const source = 'PUBLIC_BUSINESS_SOURCE';
  const leadName = `Empresa sintética ${suffix}`;
  await raw.begin(async (tx) => {
    await tx`
      insert into leads(
        id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,
        do_not_contact,crm_stage
      ) values (
        ${leadId}::uuid,'node',${`restricted-email-${suffix}`},${leadName},
        'saloes',90,'SEM_SITE_CADASTRADO',false,${options.blocked ?? false},
        ${options.doNotContact ?? false},${options.crmStage ?? 'NOVO'}
      )`;
    await tx`
      insert into pilot_runs(
        id,name,region,category,target_lead_count,status,created_by,started_at
      ) values (
        ${pilotId}::uuid,${`Piloto email ${suffix}`},'Campinas/SP','saloes',1,
        ${options.pilotStatus ?? 'RUNNING'},'integration-test',now()
      )`;
    await tx`
      insert into pilot_leads(pilot_run_id,lead_id,source,added_by)
      values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`
      insert into pilot_reviews(
        pilot_run_id,lead_id,decision,reviewer_principal_id,version
      ) values(
        ${pilotId}::uuid,${leadId}::uuid,${options.review ?? 'APPROVED'},
        'reviewer',1
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
        ${emailId}::uuid,${leadId}::uuid,'EMAIL',${options.ownership ?? 'BUSINESS'},
        'PUBLIC_BUSINESS_SOURCE',${suffix.padStart(64, 'e').slice(-64)},
        ${options.humanDecision ?? 'APPROVED'},'email-reviewer',1
      )`;
    if (options.optOut) {
      await tx`
        insert into campaign_opt_outs(lead_id,channel,reason,source)
        values(${leadId}::uuid,'EMAIL','synthetic','integration')`;
    }
  });
  return { pilotId, leadId, emailId, email, source, leadName };
};

const expectCode = async (
  action: Promise<unknown>,
  code: ManualMessagingError['code'],
) => {
  await assert.rejects(
    action,
    (error: unknown) => error instanceof ManualMessagingError && error.code === code,
  );
};

const open = async (preparationId: string, auth = primaryActor) =>
  recordManualOpen(db, preparationId, { idempotencyKey: randomUUID() }, auth);

const runtime = (
  deliver: (message: { subject: string; body: string; recipient: string }) =>
    Promise<{ provider: 'GMAIL_API'; messageId: string }>,
  overrides: Partial<{
    sendEnabled: boolean;
    killSwitchEnabled: boolean;
  }> = {},
) => ({
  sendEnabled: overrides.sendEnabled ?? true,
  killSwitchEnabled: overrides.killSwitchEnabled ?? false,
  sender: 'leadfinderbrasil@example.test',
  fingerprintKey: 'restricted-manual-email-fingerprint-key-0001',
  deliver,
});

const tableCount = async (table: string) => Number((
  await raw.unsafe(`select count(*)::int as value from public.${table}`)
)[0]?.value ?? -1);

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

  const eligible = await fixture();
  const key = randomUUID();
  const prepared = await prepareManualMessage(
    db,
    eligible.pilotId,
    eligible.leadId,
    emailInput(eligible.emailId, 'v2', key),
    primaryActor,
  );
  assert.equal(prepared.channel, 'EMAIL');
  assert.equal(prepared.templateVersion, 'v2');
  assert.equal(prepared.replayed, false);
  assert.match(prepared.contactFingerprint, /^[0-9a-f]{64}$/);
  assert.match(prepared.messageFingerprint, /^[0-9a-f]{64}$/);

  const persisted = (await raw<{
    result_snapshot: Record<string, unknown>;
    result_text: string;
  }[]>`
    select result_snapshot,result_snapshot::text as result_text
    from pilot_manual_message_preparations
    where id=${prepared.preparationId}::uuid`)[0];
  assert.ok(persisted);
  assert.equal(persisted.result_snapshot['schemaVersion'], 2);
  assert.equal(persisted.result_snapshot['templateVersion'], 'v2');
  assert.equal(persisted.result_text.includes(eligible.email), false);
  assert.equal(persisted.result_text.includes('Posso preparar'), false);
  assert.equal(persisted.result_text.includes('lead-finder-demos'), false);

  const replay = await prepareManualMessage(
    db,
    eligible.pilotId,
    eligible.leadId,
    emailInput(eligible.emailId, 'v2', key),
    primaryActor,
  );
  assert.equal(replay.preparationId, prepared.preparationId);
  assert.equal(replay.replayed, true);
  assert.equal(await tableCount('pilot_manual_message_preparations'), 1);

  const newV1 = await fixture();
  await expectCode(
    prepareManualMessage(
      db,
      newV1.pilotId,
      newV1.leadId,
      emailInput(newV1.emailId, 'v1'),
      primaryActor,
    ),
    'EMAIL_CONSUMER_UNAVAILABLE',
  );

  const historical = await fixture();
  const historicalKey = randomUUID();
  const historicalContact = (await raw<{
    contact_resolution_fingerprint: string;
  }[]>`
    select contact_resolution_fingerprint
    from lead_contacts where id=${historical.emailId}::uuid`)[0];
  assert.ok(historicalContact);
  const historicalVariables = {
    EMPRESA: historical.leadName,
    FONTE: historical.source,
  };
  const historicalPrepared = fakeProvider.prepare(
    approvedTemplates.emailV1,
    historicalVariables,
  );
  const historicalSnapshot = {
    channel: 'EMAIL',
    templateId: approvedTemplates.emailV1.id,
    templateVersion: approvedTemplates.emailV1.version,
    variables: historicalVariables,
    contactFingerprint: legacyV1ContactFingerprint(historical.emailId, historical.email),
    messageFingerprint: historicalPrepared.fingerprint,
  };
  assert.notEqual(
    historicalSnapshot.contactFingerprint,
    historicalContact.contact_resolution_fingerprint,
    'the fixture simulates a pre-0025 snapshot replayed after opaque fingerprints were introduced',
  );
  const historicalInput = emailInput(historical.emailId, 'v1', historicalKey);
  const historicalPayloadFingerprint = digest({
    pilotRunId: historical.pilotId,
    leadId: historical.leadId,
    ...historicalInput,
    principalId: primaryActor.principalId,
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
      ${primaryActor.principalId},${historicalPayloadFingerprint},${historicalKey},
      ${digest(historicalSnapshot)},${raw.json(historicalSnapshot)},
      now()+interval '24 hours'
    )`;
  const historicalReplay = await prepareManualMessage(
    db,
    historical.pilotId,
    historical.leadId,
    historicalInput,
    primaryActor,
  );
  assert.equal(historicalReplay.preparationId, historicalPreparationId);
  assert.equal(historicalReplay.templateVersion, 'v1');
  assert.equal(historicalReplay.replayed, true);

  const historicalOpen = await open(historicalPreparationId);
  assert.equal(historicalOpen.replayed, false);
  let historicalCalls = 0;
  const historicalDelivery = await sendPreparedManualEmail(
    db,
    historicalPreparationId,
    primaryActor,
    runtime(async () => {
      historicalCalls += 1;
      return { provider: 'GMAIL_API' as const, messageId: 'synthetic-historical-v1-message' };
    }),
  );
  assert.equal(historicalDelivery.state, 'DELIVERED');
  assert.equal(historicalCalls, 1);

  const incompatibleHistorical = await fixture();
  const incompatibleHistoricalKey = randomUUID();
  const incompatibleInput = emailInput(incompatibleHistorical.emailId, 'v1', incompatibleHistoricalKey);
  const incompatibleSnapshot = {
    ...historicalSnapshot,
    contactFingerprint: 'f'.repeat(64),
  };
  await raw`
    insert into pilot_manual_message_preparations(
      id,pilot_run_id,lead_id,contact_id,channel,template_id,template_version,
      operator_principal_id,payload_fingerprint,idempotency_key,
      result_fingerprint,result_snapshot,expires_at
    ) values(
      ${randomUUID()}::uuid,${incompatibleHistorical.pilotId}::uuid,
      ${incompatibleHistorical.leadId}::uuid,${incompatibleHistorical.emailId}::uuid,'EMAIL',
      ${approvedTemplates.emailV1.id},${approvedTemplates.emailV1.version},
      ${primaryActor.principalId},${digest({
        pilotRunId: incompatibleHistorical.pilotId,
        leadId: incompatibleHistorical.leadId,
        ...incompatibleInput,
        principalId: primaryActor.principalId,
      })},${incompatibleHistoricalKey},${digest(incompatibleSnapshot)}::char(64),
      ${raw.json(incompatibleSnapshot)},now()+interval '24 hours'
    )`;
  const incompatiblePreparationId = (await raw<{ id: string }[]>`
    select id from pilot_manual_message_preparations
    where pilot_run_id=${incompatibleHistorical.pilotId}::uuid`)[0]?.id;
  assert.ok(incompatiblePreparationId);
  await expectCode(open(incompatiblePreparationId), 'INVALID_STATE');

  let calls = 0;
  const successfulDelivery = async (message: {
    subject: string;
    body: string;
    recipient: string;
  }) => {
    calls += 1;
    assert.equal(message.recipient, eligible.email);
    assert.equal(message.subject.includes(eligible.leadName), true);
    assert.equal(message.body.includes('lead-finder-demos'), true);
    assert.equal('cc' in message, false);
    assert.equal('bcc' in message, false);
    assert.equal('attachments' in message, false);
    return { provider: 'GMAIL_API' as const, messageId: 'synthetic-provider-message-1' };
  };

  await expectCode(
    sendPreparedManualEmail(
      db,
      prepared.preparationId,
      primaryActor,
      runtime(successfulDelivery),
    ),
    'INVALID_STATE',
  );
  assert.equal(calls, 0);

  await expectCode(
    sendPreparedManualEmail(
      db,
      prepared.preparationId,
      primaryActor,
      runtime(successfulDelivery, { sendEnabled: false }),
    ),
    'EMAIL_CONSUMER_UNAVAILABLE',
  );
  await expectCode(
    sendPreparedManualEmail(
      db,
      prepared.preparationId,
      primaryActor,
      runtime(successfulDelivery, { killSwitchEnabled: true }),
    ),
    'EMAIL_CONSUMER_UNAVAILABLE',
  );
  assert.equal(calls, 0);

  await open(prepared.preparationId);
  const delivered = await sendPreparedManualEmail(
    db,
    prepared.preparationId,
    primaryActor,
    runtime(successfulDelivery),
  );
  assert.equal(delivered.state, 'DELIVERED');
  assert.equal(delivered.replayed, false);
  assert.match(delivered.messageIdFingerprint ?? '', /^[0-9a-f]{64}$/);
  assert.equal(calls, 1);
  assert.equal(await tableCount('pilot_manual_email_send_attempts'), 2);
  assert.equal(await tableCount('pilot_manual_email_send_events'), 2);

  const deliveredReplay = await sendPreparedManualEmail(
    db,
    prepared.preparationId,
    primaryActor,
    runtime(successfulDelivery),
  );
  assert.equal(deliveredReplay.state, 'DELIVERED');
  assert.equal(deliveredReplay.replayed, true);
  assert.equal(calls, 1);

  const blockedReplayFixture = await fixture();
  const blockedReplayPreparation = await prepareManualMessage(
    db,
    blockedReplayFixture.pilotId,
    blockedReplayFixture.leadId,
    emailInput(blockedReplayFixture.emailId),
    primaryActor,
  );
  await open(blockedReplayPreparation.preparationId);
  await raw`update leads set is_blocked=true where id=${blockedReplayFixture.leadId}::uuid`;
  const blockedReplay = await recordManualOpen(
    db,
    blockedReplayPreparation.preparationId,
    { idempotencyKey: randomUUID() },
    primaryActor,
  );
  assert.equal(blockedReplay.replayed, true);

  const completedReplayFixture = await fixture();
  const completedReplayPreparation = await prepareManualMessage(
    db,
    completedReplayFixture.pilotId,
    completedReplayFixture.leadId,
    emailInput(completedReplayFixture.emailId),
    primaryActor,
  );
  await open(completedReplayPreparation.preparationId);
  await raw`update pilot_runs set status='COMPLETED' where id=${completedReplayFixture.pilotId}::uuid`;
  const completedReplay = await recordManualOpen(
    db,
    completedReplayPreparation.preparationId,
    { idempotencyKey: randomUUID() },
    primaryActor,
  );
  assert.equal(completedReplay.replayed, true);

  await expectCode(
    recordManualOpen(
      db,
      expiredReplayPreparation.preparationId,
      { idempotencyKey: randomUUID() },
      secondaryActor,
    ),
    'INELIGIBLE',
  );

  const liveGateFixture = await fixture();
  const liveGatePreparation = await prepareManualMessage(
    db,
    liveGateFixture.pilotId,
    liveGateFixture.leadId,
    emailInput(liveGateFixture.emailId),
    primaryActor,
  );
  await raw`update leads set is_blocked=true where id=${liveGateFixture.leadId}::uuid`;
  await expectCode(open(liveGatePreparation.preparationId), 'INELIGIBLE');
  const liveGateEvents = await raw<{ count: number }[]>`
    select count(*)::int as count from pilot_manual_message_events
    where preparation_id=${liveGatePreparation.preparationId}::uuid and event_type='OPENED'`;
  assert.equal(Number(liveGateEvents[0]?.count), 0);

  const v2ChangedFixture = await fixture();
  const v2ChangedPreparation = await prepareManualMessage(
    db,
    v2ChangedFixture.pilotId,
    v2ChangedFixture.leadId,
    emailInput(v2ChangedFixture.emailId),
    primaryActor,
  );
  await raw`
    update lead_contacts
    set original_value='changed-original-value'
    where id=${v2ChangedFixture.emailId}::uuid`;
  await expectCode(open(v2ChangedPreparation.preparationId), 'INVALID_STATE');

  const concurrentOpenFixture = await fixture();
  const concurrentOpenPreparation = await prepareManualMessage(
    db,
    concurrentOpenFixture.pilotId,
    concurrentOpenFixture.leadId,
    emailInput(concurrentOpenFixture.emailId),
    primaryActor,
  );
  const concurrentOpenResults = await Promise.all([
    open(concurrentOpenPreparation.preparationId),
    open(concurrentOpenPreparation.preparationId),
  ]);
  assert.equal(concurrentOpenResults.filter((item) => !item.replayed).length, 1);
  assert.equal(concurrentOpenResults.filter((item) => item.replayed).length, 1);
  assert.equal(
    Number((await raw<{ count: number }[]>`
      select count(*)::int as count from pilot_manual_message_events
      where preparation_id=${concurrentOpenPreparation.preparationId}::uuid and event_type='OPENED'`)[0]?.count),
    1,
  );

  const differentPreparation = await fixture();
  const differentPreparationResult = await prepareManualMessage(
    db,
    differentPreparation.pilotId,
    differentPreparation.leadId,
    emailInput(differentPreparation.emailId),
    primaryActor,
  );
  await raw`update leads set is_blocked=true where id=${differentPreparation.leadId}::uuid`;
  await expectCode(open(differentPreparationResult.preparationId), 'INELIGIBLE');

  const deterministicFixture = await fixture();
  const deterministicPreparation = await prepareManualMessage(
    db,
    deterministicFixture.pilotId,
    deterministicFixture.leadId,
    emailInput(deterministicFixture.emailId),
    primaryActor,
  );
  await open(deterministicPreparation.preparationId);
  let deterministicCalls = 0;
  const deterministicRuntime = runtime(async () => {
    deterministicCalls += 1;
    throw Object.assign(new Error('synthetic rejection'), { code: 'DELIVERY_REJECTED' });
  });
  const failed = await sendPreparedManualEmail(
    db,
    deterministicPreparation.preparationId,
    primaryActor,
    deterministicRuntime,
  );
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.errorCode, 'DELIVERY_REJECTED');
  assert.equal(deterministicCalls, 1);
  const failedReplay = await sendPreparedManualEmail(
    db,
    deterministicPreparation.preparationId,
    primaryActor,
    deterministicRuntime,
  );
  assert.equal(failedReplay.state, 'FAILED');
  assert.equal(failedReplay.replayed, true);
  assert.equal(deterministicCalls, 1);

  const ambiguousFixture = await fixture();
  const ambiguousPreparation = await prepareManualMessage(
    db,
    ambiguousFixture.pilotId,
    ambiguousFixture.leadId,
    emailInput(ambiguousFixture.emailId),
    primaryActor,
  );
  await open(ambiguousPreparation.preparationId);
  let ambiguousCalls = 0;
  const ambiguousRuntime = runtime(async () => {
    ambiguousCalls += 1;
    throw Object.assign(new Error('synthetic interruption'), { code: 'DELIVERY_AMBIGUOUS' });
  });
  const ambiguous = await sendPreparedManualEmail(
    db,
    ambiguousPreparation.preparationId,
    primaryActor,
    ambiguousRuntime,
  );
  assert.equal(ambiguous.state, 'AMBIGUOUS');
  assert.equal(ambiguous.errorCode, 'PROVIDER_OUTCOME_UNKNOWN');
  const ambiguousReplay = await sendPreparedManualEmail(
    db,
    ambiguousPreparation.preparationId,
    primaryActor,
    ambiguousRuntime,
  );
  assert.equal(ambiguousReplay.state, 'AMBIGUOUS');
  assert.equal(ambiguousReplay.replayed, true);
  assert.equal(ambiguousCalls, 1);

  const concurrentFixture = await fixture();
  const concurrentPreparation = await prepareManualMessage(
    db,
    concurrentFixture.pilotId,
    concurrentFixture.leadId,
    emailInput(concurrentFixture.emailId),
    primaryActor,
  );
  await open(concurrentPreparation.preparationId);
  let concurrentCalls = 0;
  let release: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const concurrentRuntime = runtime(async () => {
    concurrentCalls += 1;
    await hold;
    return { provider: 'GMAIL_API', messageId: 'synthetic-concurrent-message' };
  });
  const firstSend = sendPreparedManualEmail(
    db,
    concurrentPreparation.preparationId,
    primaryActor,
    concurrentRuntime,
  );
  while (concurrentCalls === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  const secondSend = await sendPreparedManualEmail(
    db,
    concurrentPreparation.preparationId,
    primaryActor,
    concurrentRuntime,
  );
  assert.equal(secondSend.state, 'IN_PROGRESS');
  assert.equal(secondSend.replayed, true);
  release?.();
  const firstResult = await firstSend;
  assert.equal(firstResult.state, 'DELIVERED');
  assert.equal(concurrentCalls, 1);

  let foreignCalls = 0;
  await expectCode(
    sendPreparedManualEmail(
      db,
      concurrentPreparation.preparationId,
      secondaryActor,
      runtime(async () => {
        foreignCalls += 1;
        return { provider: 'GMAIL_API', messageId: 'never' };
      }),
    ),
    'INELIGIBLE',
  );
  assert.equal(foreignCalls, 0);

  const personal = await fixture({ ownership: 'PERSONAL' });
  await expectCode(
    prepareManualMessage(
      db,
      personal.pilotId,
      personal.leadId,
      emailInput(personal.emailId),
      primaryActor,
    ),
    'INELIGIBLE',
  );
  const optedOut = await fixture({ optOut: true });
  await expectCode(
    prepareManualMessage(
      db,
      optedOut.pilotId,
      optedOut.leadId,
      emailInput(optedOut.emailId),
      primaryActor,
    ),
    'INELIGIBLE',
  );

  const auditRows = await raw<{
    attempts: number;
    terminal_events: number;
    raw_recipient_columns: number;
  }[]>`
    select
      (select count(*)::int from pilot_manual_email_send_attempts) as attempts,
      (select count(*)::int from pilot_manual_email_send_events) as terminal_events,
      (select count(*)::int from information_schema.columns
       where table_schema='public'
         and table_name in ('pilot_manual_email_send_attempts','pilot_manual_email_send_events')
         and column_name in ('recipient','email','subject','body','payload')) as raw_recipient_columns`;
  assert.equal(auditRows[0]?.attempts, 5);
  assert.equal(auditRows[0]?.terminal_events, 5);
  assert.equal(auditRows[0]?.raw_recipient_columns, 0);

  console.log(JSON.stringify({
    result: 'RESTRICTED_MANUAL_EMAIL_PASS',
    templateV2: true,
    historicalV1Replay: true,
    historicalV1Send: true,
    historicalV1IncompatibleRejected: true,
    openedReplayBeforeLiveState: true,
    oneRecipientPerAction: true,
    ccBccAttachments: 0,
    providerCallsOnReplay: 0,
    deterministicRetry: 0,
    ambiguousRetry: 0,
    concurrencyProviderCalls: concurrentCalls,
    persistedRawRecipientColumns: 0,
    realRecipients: 0,
    messagesSent: 0,
  }));
} finally {
  await close();
  await raw.end();
}
