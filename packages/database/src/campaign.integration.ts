import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import {
  campaignAttempts, campaignDeadLetters, campaignOptOuts, campaignOutbox, campaignProviderEvents,
  campaignRecipients, campaignTemplates, campaignVersions, createAttemptWithOutbox,
  createCampaignWithVersion, createDatabase, createRecipientWithOutbox, leads, listAvailableOutbox,
  listEligibleCampaignLeads, moveOutboxToDeadLetter, recordOptOut, recordProviderEvent, updateRecipientState,
  leadContacts,
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
  const recipient = concurrent[0].data;
  assert.equal((await db.select({ value: count() }).from(campaignRecipients).where(eq(campaignRecipients.id, recipient.id)))[0]?.value, 1);
  assert.equal((await db.select({ value: count() }).from(campaignOutbox).where(and(eq(campaignOutbox.aggregateId, recipient.id), eq(campaignOutbox.eventType, 'RECIPIENT_CREATED'))))[0]?.value, 1);

  const rollbackKey = `rollback-${suffix}`;
  await assert.rejects(createRecipientWithOutbox(db, {
    ...recipientInput, leadId: lead.id, channel: 'WHATSAPP', idempotencyKey: rollbackKey, eventType: '',
  }));
  assert.equal((await db.select({ value: count() }).from(campaignRecipients).where(eq(campaignRecipients.idempotencyKey, rollbackKey)))[0]?.value, 0);

  await db.update(leads).set({ name: 'Lead Changed Later' }).where(eq(leads.id, lead.id));
  const storedSnapshot = (await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, recipient.id)).limit(1))[0]!.recipientSnapshot;
  assert.deepEqual(storedSnapshot, recipientInput.snapshot);
  await assert.rejects(db.update(campaignRecipients).set({ recipientSnapshot: { leadName: 'Mutated' } }).where(eq(campaignRecipients.id, recipient.id)), (error) => hasPgCode(error, '55000'));

  const stateResults = await Promise.allSettled([
    updateRecipientState(db, { recipientId: recipient.id, state: 'ELEGIVEL', expectedVersion: 1, idempotencyKey: `state-a-${suffix}` }),
    updateRecipientState(db, { recipientId: recipient.id, state: 'BLOQUEADO', expectedVersion: 1, idempotencyKey: `state-b-${suffix}` }),
  ]);
  assert.equal(stateResults.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = stateResults.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal((rejected.reason as CampaignPersistenceError).code, 'VERSION_CONFLICT');
  const currentRecipient = (await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, recipient.id)).limit(1))[0]!;
  assert.equal(currentRecipient.version, 2);
  await expectCode(updateRecipientState(db, { recipientId: recipient.id, state: 'CANCELADO', expectedVersion: 1, idempotencyKey: `stale-${suffix}` }), 'VERSION_CONFLICT');

  const attemptInput = { recipientId: recipient.id, payloadSnapshot: { to: 'lead@example.test', body: 'Hello' }, idempotencyKey: `attempt-${suffix}`, availableAt: new Date('2026-07-12T12:00:00Z') };
  const attempt = await createAttemptWithOutbox(db, attemptInput);
  const attemptReplay = await createAttemptWithOutbox(db, attemptInput);
  assert.equal(attemptReplay.replayed, true); assert.equal(attempt.data.id, attemptReplay.data.id);
  assert.equal((await db.select({ value: count() }).from(campaignAttempts).where(eq(campaignAttempts.recipientId, recipient.id)))[0]?.value, 1);
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
  const dead = await moveOutboxToDeadLetter(db, { outboxId: attemptOutbox.id, correlationId: `correlation-${suffix}`, error: 'Permanent failure', attempts: 5 });
  assert.equal(dead.data.payload && typeof dead.data.payload, 'object'); assert.equal(dead.data.attempts, 5);
  assert.equal((await moveOutboxToDeadLetter(db, { outboxId: attemptOutbox.id, correlationId: `correlation-${suffix}`, error: 'Permanent failure', attempts: 5 })).replayed, true);
  assert.equal((await db.select({ value: count() }).from(campaignDeadLetters).where(eq(campaignDeadLetters.outboxId, attemptOutbox.id)))[0]?.value, 1);
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
