import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import {
  campaignAttempts, campaignOptOuts, campaignOutbox, campaignProviderEvents,
  campaignRecipients, campaignTemplates, campaignVersions, createAttemptWithOutbox,
  createCampaignWithVersion, createDatabase, createRecipientWithOutbox, leads, listAvailableOutbox,
  listEligibleCampaignLeads, recordOptOut, recordProviderEvent, updateRecipientState,
  leadContacts, persistenceFingerprint,
  CampaignPersistenceError,
} from './index.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const { db, close } = createDatabase(databaseUrl);
const suffix = randomUUID();
const expectCode = async (operation: Promise<unknown>, code: string) => {
  try { await operation; assert.fail(`Expected ${code}`); }
  catch (error) { assert.equal((error as CampaignPersistenceError).code, code); }
};
const hasPgCode = (error: unknown, code: string): boolean => {
  let current = error;
  while (current && typeof current === 'object') {
    if ((current as { code?: string }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

try {
  const requiredTables = ['campaigns', 'campaign_versions', 'campaign_templates', 'campaign_recipients', 'campaign_attempts', 'campaign_provider_events', 'campaign_opt_outs', 'campaign_outbox', 'campaign_dead_letters'];
  const tables = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'campaign%'`);
  for (const table of requiredTables) assert.ok(tables.some((row) => row.table_name === table), table);
  const indexes = await db.execute<{ indexname: string }>(sql`select indexname from pg_indexes where schemaname = 'public'`);
  for (const name of ['campaign_recipients_queue_idx', 'campaign_attempts_queue_idx', 'campaign_outbox_queue_idx', 'campaign_opt_outs_global_uidx', 'campaign_opt_outs_channel_uidx'])
    assert.ok(indexes.some((row) => row.indexname === name), name);

  const lead = (await db.insert(leads).values({
    osmType: 'node', osmId: `campaign-${suffix}`, category: 'oficinas', score: 90,
    status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO',
  }).returning())[0]!;
  const eligibilityLeads = await db.insert(leads).values([
    { osmType: 'node', osmId: `whatsapp-false-${suffix}`, category: 'oficinas', score: 90, status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO' },
    { osmType: 'node', osmId: `whatsapp-true-${suffix}`, category: 'oficinas', score: 90, status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO' },
    { osmType: 'node', osmId: `email-${suffix}`, category: 'oficinas', score: 90, status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO' },
  ]).returning();
  const incompatiblePhone = eligibilityLeads[0]!; const compatiblePhone = eligibilityLeads[1]!; const emailLead = eligibilityLeads[2]!;
  const verifiedAt = new Date('2026-07-12T12:00:00Z');
  await db.insert(leadContacts).values([
    { leadId: incompatiblePhone.id, type: 'TELEFONE', originalValue: '+551100000001', normalizedValue: '+551100000001', source: 'test', confidence: '1', verifiedAt, isValid: true, possibleWhatsapp: false },
    { leadId: compatiblePhone.id, type: 'TELEFONE', originalValue: '+551100000002', normalizedValue: '+551100000002', source: 'test', confidence: '1', verifiedAt, isValid: true, possibleWhatsapp: true },
    { leadId: emailLead.id, type: 'EMAIL', originalValue: 'eligible@example.test', normalizedValue: 'eligible@example.test', source: 'test', confidence: '1', verifiedAt, isValid: true, possibleWhatsapp: false },
  ]);
  const persistenceBefore = {
    recipients: (await db.select({ value: count() }).from(campaignRecipients))[0]!.value,
    attempts: (await db.select({ value: count() }).from(campaignAttempts))[0]!.value,
    outbox: (await db.select({ value: count() }).from(campaignOutbox))[0]!.value,
  };
  const whatsappEligible = await listEligibleCampaignLeads(db, 'WHATSAPP', 100, 0);
  assert.equal(whatsappEligible.some((item) => item.lead.id === incompatiblePhone.id), false);
  assert.equal(whatsappEligible.some((item) => item.lead.id === compatiblePhone.id), true);
  const emailEligible = await listEligibleCampaignLeads(db, 'EMAIL', 100, 0);
  assert.equal(emailEligible.some((item) => item.lead.id === emailLead.id), true);
  assert.deepEqual({
    recipients: (await db.select({ value: count() }).from(campaignRecipients))[0]!.value,
    attempts: (await db.select({ value: count() }).from(campaignAttempts))[0]!.value,
    outbox: (await db.select({ value: count() }).from(campaignOutbox))[0]!.value,
  }, persistenceBefore, 'eligibility selection used by simulation must not persist excluded contacts');
  const campaignInput = { name: `Campaign ${suffix}`, channel: 'EMAIL' as const, content: 'Olá {{name}}', allowedVariables: ['name'], idempotencyKey: `campaign-${suffix}` };
  const createdCampaign = await createCampaignWithVersion(db, campaignInput);
  const replayedCampaign = await createCampaignWithVersion(db, campaignInput);
  assert.equal(createdCampaign.replayed, false); assert.equal(replayedCampaign.replayed, true);
  assert.equal(createdCampaign.data.id, replayedCampaign.data.id);
  await expectCode(createCampaignWithVersion(db, { ...campaignInput, name: 'Divergent' }), 'IDEMPOTENCY_CONFLICT');
  const version = (await db.select().from(campaignVersions).where(eq(campaignVersions.campaignId, createdCampaign.data.id)).limit(1))[0]!;
  assert.equal((await db.select({ value: count() }).from(campaignTemplates).where(eq(campaignTemplates.campaignVersionId, version.id)))[0]?.value, 1);
  await assert.rejects(db.insert(campaignTemplates).values({
    campaignVersionId: randomUUID(), channel: 'EMAIL', content: 'Orphan', allowedVariables: [], fingerprint: '0'.repeat(64),
  }), (error) => hasPgCode(error, '23503'));

  const legacyLead = (await db.insert(leads).values({
    osmType: 'node', osmId: `campaign-legacy-${suffix}`, category: 'oficinas', score: 90,
    status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO',
  }).returning())[0]!;
  const legacyRecipientPayload = {
    campaignId: createdCampaign.data.id, campaignVersionId: version.id, leadId: legacyLead.id,
    channel: 'EMAIL' as const, snapshot: { leadName: 'Legacy recipient' },
  };
  const legacyRecipient = (await db.insert(campaignRecipients).values({
    ...legacyRecipientPayload, recipientSnapshot: legacyRecipientPayload.snapshot,
    idempotencyKey: `recipient-legacy-${suffix}`,
    payloadFingerprint: persistenceFingerprint(legacyRecipientPayload),
  }).returning())[0]!;
  assert.equal(legacyRecipient.availableAt.getTime(), legacyRecipient.createdAt.getTime());
  const legacyRecipientReplay = await createRecipientWithOutbox(db, {
    ...legacyRecipientPayload, idempotencyKey: legacyRecipient.idempotencyKey,
  });
  assert.equal(legacyRecipientReplay.replayed, true);
  assert.equal(legacyRecipientReplay.data.id, legacyRecipient.id);
  await expectCode(createRecipientWithOutbox(db, {
    ...legacyRecipientPayload, snapshot: { leadName: 'Divergent legacy recipient' },
    idempotencyKey: legacyRecipient.idempotencyKey,
  }), 'IDEMPOTENCY_CONFLICT');
  await expectCode(createRecipientWithOutbox(db, {
    ...legacyRecipientPayload, idempotencyKey: legacyRecipient.idempotencyKey,
    availableAt: new Date(legacyRecipient.availableAt.getTime() + 1_000),
  }), 'IDEMPOTENCY_CONFLICT');
  await db.update(campaignRecipients).set({
    availableAt: new Date(legacyRecipient.availableAt.getTime() + 1_000),
  }).where(eq(campaignRecipients.id, legacyRecipient.id));
  await expectCode(createRecipientWithOutbox(db, {
    ...legacyRecipientPayload, idempotencyKey: legacyRecipient.idempotencyKey,
  }), 'IDEMPOTENCY_CONFLICT');

  const nullLead = (await db.insert(leads).values({
    osmType: 'node', osmId: `campaign-null-${suffix}`, category: 'oficinas', score: 90,
    status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO',
  }).returning())[0]!;
  const nullRecipientInput = {
    campaignId: createdCampaign.data.id, campaignVersionId: version.id, leadId: nullLead.id,
    channel: 'EMAIL' as const, snapshot: { leadName: 'Null schedule' }, idempotencyKey: `recipient-null-${suffix}`,
  };
  const nullRecipient = await createRecipientWithOutbox(db, nullRecipientInput);
  const nullRecipientReplay = await createRecipientWithOutbox(db, nullRecipientInput);
  assert.equal(nullRecipientReplay.replayed, true);
  assert.equal(nullRecipientReplay.data.id, nullRecipient.data.id);
  await expectCode(createRecipientWithOutbox(db, {
    ...nullRecipientInput, snapshot: { leadName: 'Divergent null schedule' },
  }), 'IDEMPOTENCY_CONFLICT');

  const recipientInput = {
    campaignId: createdCampaign.data.id, campaignVersionId: version.id, leadId: lead.id, channel: 'EMAIL' as const,
    snapshot: { leadName: 'Snapshot Original', address: 'Rua A' }, idempotencyKey: `recipient-${suffix}`,
    availableAt: new Date('2026-07-12T12:00:00Z'),
  };
  const concurrent = await Promise.all([
    createRecipientWithOutbox(db, recipientInput), createRecipientWithOutbox(db, recipientInput),
  ]);
  assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [false, true]);
  assert.equal(new Set(concurrent.map((result) => result.data.id)).size, 1);
  await expectCode(createRecipientWithOutbox(db, { ...recipientInput, snapshot: { leadName: 'Changed' } }), 'IDEMPOTENCY_CONFLICT');
  await expectCode(createRecipientWithOutbox(db, {
    ...recipientInput, availableAt: new Date('2026-07-12T12:00:01Z'),
  }), 'IDEMPOTENCY_CONFLICT');
  const recipient = concurrent[0].data;
  assert.equal((await db.select({ value: count() }).from(campaignRecipients).where(eq(campaignRecipients.id, recipient.id)))[0]?.value, 1);
  assert.equal((await db.select({ value: count() }).from(campaignOutbox).where(and(eq(campaignOutbox.aggregateId, recipient.id), eq(campaignOutbox.eventType, 'RECIPIENT_CREATED'))))[0]?.value, 1);
  const recipientOutbox = (await db.select().from(campaignOutbox).where(and(
    eq(campaignOutbox.aggregateId, recipient.id), eq(campaignOutbox.eventType, 'RECIPIENT_CREATED'),
  )).limit(1))[0]!;
  assert.equal(recipient.availableAt.toISOString(), recipientInput.availableAt.toISOString());
  assert.equal(recipientOutbox.availableAt.toISOString(), recipientInput.availableAt.toISOString());

  const rollbackKey = `rollback-${suffix}`;
  await assert.rejects(createRecipientWithOutbox(db, {
    ...recipientInput, leadId: lead.id, channel: 'WHATSAPP', idempotencyKey: rollbackKey, eventType: '',
  }));
  assert.equal((await db.select({ value: count() }).from(campaignRecipients).where(eq(campaignRecipients.idempotencyKey, rollbackKey)))[0]?.value, 0);

  await db.update(leads).set({ name: 'Lead Changed Later' }).where(eq(leads.id, lead.id));
  const storedSnapshot = (await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, recipient.id)).limit(1))[0]!.recipientSnapshot;
  assert.deepEqual(storedSnapshot, recipientInput.snapshot);
  await assert.rejects(db.update(campaignRecipients).set({ recipientSnapshot: { leadName: 'Mutated' } }).where(eq(campaignRecipients.id, recipient.id)), (error) => hasPgCode(error, '55000'));

  const validTransition = await updateRecipientState(db, {
    recipientId: recipient.id, state: 'ELEGIVEL', expectedVersion: 1, idempotencyKey: `state-valid-${suffix}`,
  });
  assert.equal(validTransition.data.state, 'ELEGIVEL'); assert.equal(validTransition.data.version, 2);
  const transitionReplay = await updateRecipientState(db, {
    recipientId: recipient.id, state: 'ELEGIVEL', expectedVersion: 1, idempotencyKey: `state-valid-${suffix}`,
  });
  assert.equal(transitionReplay.replayed, true); assert.equal(transitionReplay.data.id, recipient.id);
  await expectCode(updateRecipientState(db, {
    recipientId: recipient.id, state: 'PENDENTE', expectedVersion: 2, idempotencyKey: `state-invalid-${suffix}`,
  }), 'INVALID_TRANSITION');
  await expectCode(updateRecipientState(db, {
    recipientId: recipient.id, state: 'BLOQUEADO', expectedVersion: 1, idempotencyKey: `state-stale-${suffix}`,
  }), 'VERSION_CONFLICT');
  const terminalTransition = await updateRecipientState(db, {
    recipientId: recipient.id, state: 'CANCELADO', expectedVersion: 2, idempotencyKey: `state-terminal-${suffix}`,
  });
  assert.equal(terminalTransition.data.state, 'CANCELADO'); assert.equal(terminalTransition.data.version, 3);
  await expectCode(updateRecipientState(db, {
    recipientId: recipient.id, state: 'ELEGIVEL', expectedVersion: 3, idempotencyKey: `state-terminal-exit-${suffix}`,
  }), 'INVALID_TRANSITION');

  const concurrentLead = (await db.insert(leads).values({
    osmType: 'node', osmId: `campaign-concurrent-${suffix}`, category: 'oficinas', score: 90,
    status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO',
  }).returning())[0]!;
  const concurrentRecipient = (await createRecipientWithOutbox(db, {
    ...recipientInput, leadId: concurrentLead.id, idempotencyKey: `recipient-concurrent-${suffix}`,
  })).data;
  const stateResults = await Promise.allSettled([
    updateRecipientState(db, { recipientId: concurrentRecipient.id, state: 'ELEGIVEL', expectedVersion: 1, idempotencyKey: `state-a-${suffix}` }),
    updateRecipientState(db, { recipientId: concurrentRecipient.id, state: 'BLOQUEADO', expectedVersion: 1, idempotencyKey: `state-b-${suffix}` }),
  ]);
  assert.equal(stateResults.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = stateResults.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal((rejected.reason as CampaignPersistenceError).code, 'VERSION_CONFLICT');
  const currentConcurrentRecipient = (await db.select().from(campaignRecipients)
    .where(eq(campaignRecipients.id, concurrentRecipient.id)).limit(1))[0]!;
  assert.equal(currentConcurrentRecipient.version, 2);

  const attemptInput = { recipientId: recipient.id, payloadSnapshot: { to: 'lead@example.test', body: 'Hello' }, idempotencyKey: `attempt-${suffix}`, availableAt: new Date('2026-07-12T12:00:00Z') };
  const attempt = await createAttemptWithOutbox(db, attemptInput);
  const attemptReplay = await createAttemptWithOutbox(db, attemptInput);
  assert.equal(attemptReplay.replayed, true); assert.equal(attempt.data.id, attemptReplay.data.id);
  await expectCode(createAttemptWithOutbox(db, {
    ...attemptInput, availableAt: new Date('2026-07-12T12:00:01Z'),
  }), 'IDEMPOTENCY_CONFLICT');
  assert.equal((await db.select({ value: count() }).from(campaignAttempts).where(eq(campaignAttempts.recipientId, recipient.id)))[0]?.value, 1);
  const scheduledAttemptOutbox = (await db.select().from(campaignOutbox).where(and(
    eq(campaignOutbox.aggregateId, attempt.data.id), eq(campaignOutbox.eventType, 'ATTEMPT_CREATED'),
  )).limit(1))[0]!;
  assert.equal(attempt.data.availableAt.toISOString(), attemptInput.availableAt.toISOString());
  assert.equal(scheduledAttemptOutbox.availableAt.toISOString(), attemptInput.availableAt.toISOString());
  await expectCode(createAttemptWithOutbox(db, {
    ...attemptInput, payloadSnapshot: { to: 'other@example.test', body: 'Changed' },
  }), 'IDEMPOTENCY_CONFLICT');

  const legacyAttemptPayload = { recipientId: legacyRecipient.id, payloadSnapshot: { body: 'Legacy attempt' } };
  const legacyAttempt = (await db.insert(campaignAttempts).values({
    ...legacyAttemptPayload, idempotencyKey: `attempt-legacy-${suffix}`,
    payloadFingerprint: persistenceFingerprint(legacyAttemptPayload),
  }).returning())[0]!;
  assert.equal(legacyAttempt.availableAt.getTime(), legacyAttempt.createdAt.getTime());
  const legacyAttemptReplay = await createAttemptWithOutbox(db, {
    ...legacyAttemptPayload, idempotencyKey: legacyAttempt.idempotencyKey,
  });
  assert.equal(legacyAttemptReplay.replayed, true);
  assert.equal(legacyAttemptReplay.data.id, legacyAttempt.id);
  await expectCode(createAttemptWithOutbox(db, {
    ...legacyAttemptPayload, payloadSnapshot: { body: 'Divergent legacy attempt' },
    idempotencyKey: legacyAttempt.idempotencyKey,
  }), 'IDEMPOTENCY_CONFLICT');
  await expectCode(createAttemptWithOutbox(db, {
    ...legacyAttemptPayload, idempotencyKey: legacyAttempt.idempotencyKey,
    availableAt: new Date(legacyAttempt.availableAt.getTime() + 1_000),
  }), 'IDEMPOTENCY_CONFLICT');
  await db.update(campaignAttempts).set({
    availableAt: new Date(legacyAttempt.availableAt.getTime() + 1_000),
  }).where(eq(campaignAttempts.id, legacyAttempt.id));
  await expectCode(createAttemptWithOutbox(db, {
    ...legacyAttemptPayload, idempotencyKey: legacyAttempt.idempotencyKey,
  }), 'IDEMPOTENCY_CONFLICT');

  const nullAttemptInput = {
    recipientId: nullRecipient.data.id, payloadSnapshot: { body: 'Null schedule attempt' },
    idempotencyKey: `attempt-null-${suffix}`,
  };
  const nullAttempt = await createAttemptWithOutbox(db, nullAttemptInput);
  const nullAttemptReplay = await createAttemptWithOutbox(db, nullAttemptInput);
  assert.equal(nullAttemptReplay.replayed, true);
  assert.equal(nullAttemptReplay.data.id, nullAttempt.data.id);
  await expectCode(createAttemptWithOutbox(db, {
    ...nullAttemptInput, payloadSnapshot: { body: 'Divergent null attempt' },
  }), 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(db.update(campaignAttempts).set({ payloadSnapshot: { body: 'Mutated' } }).where(eq(campaignAttempts.id, attempt.data.id)), (error) => hasPgCode(error, '55000'));
  await assert.rejects(db.delete(campaignRecipients).where(eq(campaignRecipients.id, recipient.id)), (error) => hasPgCode(error, '55000'));

  const providerInput = { attemptId: attempt.data.id, provider: 'test-provider', externalId: `external-${suffix}`, eventType: 'DELIVERED', payload: { status: 'ok' }, occurredAt: new Date('2026-07-12T13:00:00Z') };
  assert.equal((await recordProviderEvent(db, providerInput)).replayed, false);
  assert.equal((await recordProviderEvent(db, providerInput)).replayed, true);
  await expectCode(recordProviderEvent(db, { ...providerInput, payload: { status: 'changed' } }), 'IDEMPOTENCY_CONFLICT');
  assert.equal((await db.select({ value: count() }).from(campaignProviderEvents).where(eq(campaignProviderEvents.externalId, providerInput.externalId)))[0]?.value, 1);

  assert.equal((await recordOptOut(db, { leadId: lead.id, channel: null, reason: 'Global request', source: 'test' })).replayed, false);
  assert.equal((await recordOptOut(db, { leadId: lead.id, channel: null, reason: 'Global request', source: 'test' })).replayed, true);
  assert.equal((await recordOptOut(db, { leadId: lead.id, channel: 'EMAIL', reason: 'Email request', source: 'test' })).replayed, false);
  assert.equal((await db.select({ value: count() }).from(campaignOptOuts).where(eq(campaignOptOuts.leadId, lead.id)))[0]?.value, 2);

  const attemptOutbox = (await db.select().from(campaignOutbox).where(and(eq(campaignOutbox.aggregateId, attempt.data.id), eq(campaignOutbox.eventType, 'ATTEMPT_CREATED'))).limit(1))[0]!;
  const claimedAt = new Date('2026-07-13T00:00:00Z');
  await db.update(campaignOutbox).set({
    claimWorkerId: 'dead-letter-worker',
    claimToken: randomUUID(),
    claimGeneration: 1,
    claimedAt,
    claimExpiresAt: new Date(claimedAt.getTime() + 60_000),
  }).where(eq(campaignOutbox.id, attemptOutbox.id));
  await assert.rejects(db.delete(campaignAttempts).where(eq(campaignAttempts.id, attempt.data.id)), (error) => hasPgCode(error, '55000'));
  await assert.rejects(db.delete(campaignOutbox).where(eq(campaignOutbox.id, attemptOutbox.id)), (error) => hasPgCode(error, '55000'));

  const queue = await listAvailableOutbox(db, new Date('2026-07-13T00:00:00Z'));
  const sorted = [...queue].sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime() || a.id.localeCompare(b.id));
  assert.deepEqual(queue.map((row) => row.id), sorted.map((row) => row.id));
  const direct = await db.select().from(campaignOutbox).where(eq(campaignOutbox.status, 'PENDING')).orderBy(asc(campaignOutbox.availableAt), asc(campaignOutbox.id));
  assert.ok(direct.length >= queue.length);
  console.log('Campaign persistence PostgreSQL integration passed');
} finally {
  await close();
}
