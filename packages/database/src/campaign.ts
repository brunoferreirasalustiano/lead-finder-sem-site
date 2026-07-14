import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import {
  assertCampaignTransition, campaignRecipientTransitionGraph, campaignTransitionGraph, campaignVersionTransitionGraph,
  type CampaignChannel, type CampaignRecipientState, type CampaignState, type CampaignVersionState,
} from '@lead-finder/shared';
import type { Database } from './index.js';
import {
  campaignAttempts, campaignDeadLetters, campaignOptOuts, campaignOutbox,
  campaignProviderEvents, campaignRecipients, campaigns, campaignTemplates, campaignVersions,
  leadContacts, leads,
} from './schema.js';

export const campaignPersistenceErrorCodes = ['IDEMPOTENCY_CONFLICT', 'LOGICAL_CONFLICT', 'VERSION_CONFLICT', 'NOT_FOUND'] as const;
export type CampaignPersistenceErrorCode = (typeof campaignPersistenceErrorCodes)[number];
export class CampaignPersistenceError extends Error {
  readonly name = 'CampaignPersistenceError';
  constructor(message: string, readonly code: CampaignPersistenceErrorCode) {
    super(message); Object.setPrototypeOf(this, new.target.prototype);
  }
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonicalize(nested)]),
  );
  return value;
};
export const persistenceFingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const postgresCode = (error: unknown, code: string): boolean => {
  let current = error;
  while (current && typeof current === 'object') {
    if ((current as { code?: string }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const lock = (tx: Tx, scope: string, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${scope}:${key}`}))`);
const assertFingerprint = (actual: string, expected: string) => {
  if (actual !== expected) throw new CampaignPersistenceError('Idempotency key reused with divergent payload', 'IDEMPOTENCY_CONFLICT');
};
const assertScheduledFingerprint = (existing: {
  payloadFingerprint: string; availableAt: Date; createdAt: Date;
}, current: string, legacy: string, requestedAvailableAt?: Date) => {
  if (existing.payloadFingerprint === current) return;
  const isLegacyUnscheduledReplay = requestedAvailableAt === undefined
    && existing.payloadFingerprint === legacy
    && existing.availableAt.getTime() === existing.createdAt.getTime();
  if (!isLegacyUnscheduledReplay) assertFingerprint(existing.payloadFingerprint, current);
};
export const assertCampaignAcceptsReservations = (campaignState: string, versionState: string) => {
  if (campaignState !== 'ATIVA') throw new CampaignPersistenceError('Campaign does not accept new simulated reservations', 'LOGICAL_CONFLICT');
  if (versionState !== 'APROVADA') throw new CampaignPersistenceError('Campaign version is not approved', 'LOGICAL_CONFLICT');
};
const insertOutbox = async (tx: Tx, input: { aggregateType: string; aggregateId: string; eventType: string; payload: unknown; idempotencyKey: string; fingerprint: string; availableAt?: Date | undefined }) =>
  (await tx.insert(campaignOutbox).values({
    aggregateType: input.aggregateType, aggregateId: input.aggregateId, eventType: input.eventType,
    payload: input.payload, idempotencyKey: input.idempotencyKey, payloadFingerprint: input.fingerprint,
    availableAt: input.availableAt,
  }).returning())[0]!;

export async function createCampaignWithVersion(db: Database, input: {
  name: string; channel: CampaignChannel; content: string; allowedVariables: readonly string[]; idempotencyKey: string;
}) {
  const payload = { name: input.name, channel: input.channel, content: input.content, allowedVariables: [...input.allowedVariables] };
  const fingerprint = persistenceFingerprint(payload);
  return db.transaction(async (tx) => {
    await lock(tx, 'campaign:create', input.idempotencyKey);
    const existing = (await tx.select().from(campaigns).where(eq(campaigns.idempotencyKey, input.idempotencyKey)).limit(1))[0];
    if (existing) { assertFingerprint(existing.payloadFingerprint, fingerprint); return { data: existing, replayed: true }; }
    const campaign = (await tx.insert(campaigns).values({ name: input.name, idempotencyKey: input.idempotencyKey, payloadFingerprint: fingerprint }).returning())[0]!;
    const version = (await tx.insert(campaignVersions).values({ campaignId: campaign.id, versionNumber: 1 }).returning())[0]!;
    await tx.insert(campaignTemplates).values({ campaignVersionId: version.id, channel: input.channel, content: input.content, allowedVariables: input.allowedVariables, fingerprint });
    await insertOutbox(tx, { aggregateType: 'campaign', aggregateId: campaign.id, eventType: 'CAMPAIGN_CREATED', payload, idempotencyKey: input.idempotencyKey, fingerprint });
    return { data: campaign, replayed: false };
  });
}

export async function createRecipientWithOutbox(db: Database, input: {
  campaignId: string; campaignVersionId: string; leadId: string; channel: CampaignChannel;
  snapshot: Readonly<Record<string, unknown>>; idempotencyKey: string; availableAt?: Date; eventType?: string;
  requireActiveApproved?: boolean;
}) {
  const payload = { campaignId: input.campaignId, campaignVersionId: input.campaignVersionId, leadId: input.leadId, channel: input.channel, snapshot: input.snapshot };
  const legacyFingerprint = persistenceFingerprint(payload);
  const fingerprint = persistenceFingerprint({ ...payload, availableAt: input.availableAt?.toISOString() ?? null });
  try {
    return await db.transaction(async (tx) => {
      await lock(tx, `campaign:${input.campaignId}:recipient`, input.idempotencyKey);
      const existing = (await tx.select().from(campaignRecipients).where(and(
        eq(campaignRecipients.campaignId, input.campaignId), eq(campaignRecipients.idempotencyKey, input.idempotencyKey),
      )).limit(1))[0];
      if (existing) {
        assertScheduledFingerprint(existing, fingerprint, legacyFingerprint, input.availableAt);
        return { data: existing, replayed: true };
      }
      if (input.requireActiveApproved) {
        const campaign = (await tx.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).for('update').limit(1))[0];
        if (!campaign) throw new CampaignPersistenceError('Campaign not found', 'NOT_FOUND');
        const version = (await tx.select().from(campaignVersions).where(and(eq(campaignVersions.id, input.campaignVersionId), eq(campaignVersions.campaignId, input.campaignId))).limit(1))[0];
        if (!version) throw new CampaignPersistenceError('Campaign version not found', 'NOT_FOUND');
        assertCampaignAcceptsReservations(campaign.state, version.state);
      }
      const recipient = (await tx.insert(campaignRecipients).values({
        campaignId: input.campaignId, campaignVersionId: input.campaignVersionId, leadId: input.leadId,
        channel: input.channel, recipientSnapshot: input.snapshot, idempotencyKey: input.idempotencyKey,
        payloadFingerprint: fingerprint, availableAt: input.availableAt,
      }).returning())[0]!;
      await insertOutbox(tx, { aggregateType: 'recipient', aggregateId: recipient.id, eventType: input.eventType ?? 'RECIPIENT_CREATED', payload, idempotencyKey: input.idempotencyKey, fingerprint, availableAt: input.availableAt });
      return { data: recipient, replayed: false };
    });
  } catch (error) {
    if (postgresCode(error, '23505')) throw new CampaignPersistenceError('Recipient already exists for campaign, version, lead and channel', 'LOGICAL_CONFLICT');
    throw error;
  }
}

export async function createAttemptWithOutbox(db: Database, input: {
  recipientId: string; payloadSnapshot: Readonly<Record<string, unknown>>; idempotencyKey: string; availableAt?: Date;
}) {
  const payload = { recipientId: input.recipientId, payloadSnapshot: input.payloadSnapshot };
  const legacyFingerprint = persistenceFingerprint(payload);
  const fingerprint = persistenceFingerprint({ ...payload, availableAt: input.availableAt?.toISOString() ?? null });
  return db.transaction(async (tx) => {
    await lock(tx, `recipient:${input.recipientId}:attempt`, input.idempotencyKey);
    const existing = (await tx.select().from(campaignAttempts).where(and(
      eq(campaignAttempts.recipientId, input.recipientId), eq(campaignAttempts.idempotencyKey, input.idempotencyKey),
    )).limit(1))[0];
    if (existing) {
      assertScheduledFingerprint(existing, fingerprint, legacyFingerprint, input.availableAt);
      return { data: existing, replayed: true };
    }
    const attempt = (await tx.insert(campaignAttempts).values({
      recipientId: input.recipientId, payloadSnapshot: input.payloadSnapshot, idempotencyKey: input.idempotencyKey,
      payloadFingerprint: fingerprint, availableAt: input.availableAt,
    }).returning())[0]!;
    await insertOutbox(tx, { aggregateType: 'attempt', aggregateId: attempt.id, eventType: 'ATTEMPT_CREATED', payload, idempotencyKey: input.idempotencyKey, fingerprint, availableAt: input.availableAt });
    return { data: attempt, replayed: false };
  });
}

export async function updateRecipientState(db: Database, input: {
  recipientId: string; state: CampaignRecipientState; expectedVersion: number; idempotencyKey: string;
}) {
  const payload = { recipientId: input.recipientId, state: input.state, expectedVersion: input.expectedVersion };
  const fingerprint = persistenceFingerprint(payload);
  return db.transaction(async (tx) => {
    await lock(tx, `recipient:${input.recipientId}:state`, input.idempotencyKey);
    const priorEvent = (await tx.select().from(campaignOutbox).where(and(
      eq(campaignOutbox.aggregateType, 'recipient-state'), eq(campaignOutbox.aggregateId, input.recipientId),
      eq(campaignOutbox.idempotencyKey, input.idempotencyKey),
    )).limit(1))[0];
    if (priorEvent) {
      assertFingerprint(priorEvent.payloadFingerprint, fingerprint);
      const row = (await tx.select().from(campaignRecipients).where(eq(campaignRecipients.id, input.recipientId)).limit(1))[0];
      if (!row) throw new CampaignPersistenceError('Recipient not found', 'NOT_FOUND');
      return { data: row, replayed: true };
    }
    const current = (await tx.select().from(campaignRecipients)
      .where(eq(campaignRecipients.id, input.recipientId)).for('update').limit(1))[0];
    if (!current) throw new CampaignPersistenceError('Recipient not found', 'NOT_FOUND');
    if (current.version !== input.expectedVersion)
      throw new CampaignPersistenceError('Recipient version conflict', 'VERSION_CONFLICT');
    assertCampaignTransition(
      campaignRecipientTransitionGraph,
      current.state as CampaignRecipientState,
      input.state,
    );
    const row = (await tx.update(campaignRecipients).set({
      state: input.state, version: sql`${campaignRecipients.version} + 1`, updatedAt: new Date(),
    }).where(and(eq(campaignRecipients.id, input.recipientId), eq(campaignRecipients.version, input.expectedVersion))).returning())[0];
    if (!row) throw new CampaignPersistenceError('Recipient version conflict', 'VERSION_CONFLICT');
    await insertOutbox(tx, { aggregateType: 'recipient-state', aggregateId: row.id, eventType: 'RECIPIENT_STATE_CHANGED', payload, idempotencyKey: input.idempotencyKey, fingerprint });
    return { data: row, replayed: false };
  });
}

export async function recordProviderEvent(db: Database, input: {
  attemptId: string; provider: string; externalId: string; eventType: string; payload: unknown; occurredAt: Date;
}) {
  const fingerprint = persistenceFingerprint({ attemptId: input.attemptId, eventType: input.eventType, payload: input.payload, occurredAt: input.occurredAt.toISOString() });
  return db.transaction(async (tx) => {
    await lock(tx, `provider:${input.provider}`, input.externalId);
    const existing = (await tx.select().from(campaignProviderEvents).where(and(
      eq(campaignProviderEvents.provider, input.provider), eq(campaignProviderEvents.externalId, input.externalId),
    )).limit(1))[0];
    if (existing) { assertFingerprint(existing.payloadFingerprint, fingerprint); return { data: existing, replayed: true }; }
    const row = (await tx.insert(campaignProviderEvents).values({ ...input, payloadFingerprint: fingerprint }).returning())[0]!;
    return { data: row, replayed: false };
  });
}

export async function recordOptOut(db: Database, input: { leadId: string; channel: CampaignChannel | null; reason: string; source: string }) {
  return db.transaction(async (tx) => {
    await lock(tx, `lead:${input.leadId}:opt-out`, input.channel ?? 'TODOS');
    const where = and(eq(campaignOptOuts.leadId, input.leadId), input.channel === null ? isNull(campaignOptOuts.channel) : eq(campaignOptOuts.channel, input.channel));
    const existing = (await tx.select().from(campaignOptOuts).where(where).limit(1))[0];
    if (existing) return { data: existing, replayed: true };
    const row = (await tx.insert(campaignOptOuts).values(input).returning())[0]!;
    return { data: row, replayed: false };
  });
}

export const listAvailableOutbox = (db: Database, now: Date, limit = 100, offset = 0) => db.select().from(campaignOutbox)
  .where(and(eq(campaignOutbox.status, 'PENDING'), lte(campaignOutbox.availableAt, now)))
  .orderBy(asc(campaignOutbox.availableAt), asc(campaignOutbox.id)).limit(Math.min(100, Math.max(1, limit))).offset(Math.max(0, offset));
export const listAvailableRecipients = (db: Database, now: Date, limit = 100, offset = 0) => db.select().from(campaignRecipients)
  .where(and(sql`${campaignRecipients.state} in ('PENDENTE', 'ELEGIVEL')`, lte(campaignRecipients.availableAt, now)))
  .orderBy(asc(campaignRecipients.availableAt), asc(campaignRecipients.id)).limit(Math.min(100, Math.max(1, limit))).offset(Math.max(0, offset));
export const listAvailableAttempts = (db: Database, now: Date, limit = 100, offset = 0) => db.select().from(campaignAttempts)
  .where(and(sql`${campaignAttempts.state} in ('PENDENTE', 'APROVADA')`, lte(campaignAttempts.availableAt, now)))
  .orderBy(asc(campaignAttempts.availableAt), asc(campaignAttempts.id)).limit(Math.min(100, Math.max(1, limit))).offset(Math.max(0, offset));

export const getCampaign = async (db: Database, id: string) => {
  const campaign = (await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1))[0];
  if (!campaign) throw new CampaignPersistenceError('Campaign not found', 'NOT_FOUND');
  return campaign;
};
export const listCampaigns = (db: Database, limit: number, offset: number) => db.select().from(campaigns)
  .orderBy(desc(campaigns.createdAt), desc(campaigns.id)).limit(limit).offset(offset);
export const listCampaignVersions = (db: Database, campaignId: string) => db.select().from(campaignVersions)
  .where(eq(campaignVersions.campaignId, campaignId)).orderBy(desc(campaignVersions.versionNumber), desc(campaignVersions.id));
export const listCampaignTemplates = (db: Database, campaignVersionId: string) => db.select().from(campaignTemplates)
  .where(eq(campaignTemplates.campaignVersionId, campaignVersionId)).orderBy(asc(campaignTemplates.channel), asc(campaignTemplates.id));

export async function createCampaignVersion(db: Database, input: {
  campaignId: string; channel: CampaignChannel; content: string; allowedVariables: readonly string[]; idempotencyKey: string;
}) {
  const payload = { campaignId: input.campaignId, channel: input.channel, content: input.content, allowedVariables: [...input.allowedVariables] };
  const fingerprint = persistenceFingerprint(payload);
  return db.transaction(async (tx) => {
    await lock(tx, `campaign:${input.campaignId}:version`, input.idempotencyKey);
    const replay = (await tx.select().from(campaignOutbox).where(and(eq(campaignOutbox.aggregateType, 'campaign-version'), eq(campaignOutbox.aggregateId, input.campaignId), eq(campaignOutbox.idempotencyKey, input.idempotencyKey))).limit(1))[0];
    if (replay) {
      assertFingerprint(replay.payloadFingerprint, fingerprint);
      const versionId = (replay.payload as { versionId: string }).versionId;
      const version = (await tx.select().from(campaignVersions).where(eq(campaignVersions.id, versionId)).limit(1))[0]!;
      return { data: version, replayed: true };
    }
    const campaign = (await tx.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).for('update').limit(1))[0];
    if (!campaign) throw new CampaignPersistenceError('Campaign not found', 'NOT_FOUND');
    if (campaign.state !== 'RASCUNHO') throw new CampaignPersistenceError('Versions can only be added to draft campaigns', 'LOGICAL_CONFLICT');
    const latest = (await tx.select().from(campaignVersions).where(eq(campaignVersions.campaignId, input.campaignId)).orderBy(desc(campaignVersions.versionNumber)).limit(1))[0];
    const version = (await tx.insert(campaignVersions).values({ campaignId: input.campaignId, versionNumber: (latest?.versionNumber ?? 0) + 1 }).returning())[0]!;
    await tx.insert(campaignTemplates).values({ campaignVersionId: version.id, channel: input.channel, content: input.content, allowedVariables: input.allowedVariables, fingerprint });
    await insertOutbox(tx, { aggregateType: 'campaign-version', aggregateId: input.campaignId, eventType: 'CAMPAIGN_VERSION_CREATED', payload: { ...payload, versionId: version.id }, idempotencyKey: input.idempotencyKey, fingerprint });
    return { data: version, replayed: false };
  });
}

export async function transitionCampaign(db: Database, input: { campaignId: string; state: CampaignState; expectedVersion: number; idempotencyKey: string; actor: string }) {
  const payload = { campaignId: input.campaignId, state: input.state, expectedVersion: input.expectedVersion, actor: input.actor };
  const fingerprint = persistenceFingerprint(payload);
  return db.transaction(async (tx) => {
    await lock(tx, `campaign:${input.campaignId}:state`, input.idempotencyKey);
    const replay = (await tx.select().from(campaignOutbox).where(and(eq(campaignOutbox.aggregateType, 'campaign-state'), eq(campaignOutbox.aggregateId, input.campaignId), eq(campaignOutbox.idempotencyKey, input.idempotencyKey))).limit(1))[0];
    if (replay) { assertFingerprint(replay.payloadFingerprint, fingerprint); return { data: (await tx.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).limit(1))[0]!, replayed: true }; }
    const current = (await tx.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).limit(1))[0];
    if (!current) throw new CampaignPersistenceError('Campaign not found', 'NOT_FOUND');
    assertCampaignTransition(campaignTransitionGraph, current.state as CampaignState, input.state);
    if (input.state === 'ATIVA') {
      const approved = (await tx.select({ id: campaignVersions.id }).from(campaignVersions).where(and(eq(campaignVersions.campaignId, input.campaignId), eq(campaignVersions.state, 'APROVADA'))).limit(1))[0];
      if (!approved) throw new CampaignPersistenceError('Campaign requires an approved version before activation', 'LOGICAL_CONFLICT');
    }
    const row = (await tx.update(campaigns).set({ state: input.state, version: sql`${campaigns.version} + 1`, updatedAt: new Date() }).where(and(eq(campaigns.id, input.campaignId), eq(campaigns.version, input.expectedVersion))).returning())[0];
    if (!row) throw new CampaignPersistenceError('Campaign version conflict', 'VERSION_CONFLICT');
    await insertOutbox(tx, { aggregateType: 'campaign-state', aggregateId: row.id, eventType: 'CAMPAIGN_STATE_CHANGED', payload, idempotencyKey: input.idempotencyKey, fingerprint });
    return { data: row, replayed: false };
  });
}

export async function transitionCampaignVersion(db: Database, input: { campaignVersionId: string; state: CampaignVersionState; idempotencyKey: string; actor: string; approvedAt?: Date | undefined }) {
  const payload = { campaignVersionId: input.campaignVersionId, state: input.state, actor: input.actor, approvedAt: input.approvedAt?.toISOString() };
  const fingerprint = persistenceFingerprint(payload);
  return db.transaction(async (tx) => {
    await lock(tx, `campaign-version:${input.campaignVersionId}:state`, input.idempotencyKey);
    const replay = (await tx.select().from(campaignOutbox).where(and(eq(campaignOutbox.aggregateType, 'campaign-version-state'), eq(campaignOutbox.aggregateId, input.campaignVersionId), eq(campaignOutbox.idempotencyKey, input.idempotencyKey))).limit(1))[0];
    if (replay) { assertFingerprint(replay.payloadFingerprint, fingerprint); return { data: (await tx.select().from(campaignVersions).where(eq(campaignVersions.id, input.campaignVersionId)).limit(1))[0]!, replayed: true }; }
    const current = (await tx.select().from(campaignVersions).where(eq(campaignVersions.id, input.campaignVersionId)).for('update').limit(1))[0];
    if (!current) throw new CampaignPersistenceError('Campaign version not found', 'NOT_FOUND');
    assertCampaignTransition(campaignVersionTransitionGraph, current.state as CampaignVersionState, input.state);
    if (input.state === 'APROVADA' && (!input.actor.trim() || !input.approvedAt || !Number.isFinite(input.approvedAt.getTime()))) throw new CampaignPersistenceError('Human approval requires actor and valid timestamp', 'LOGICAL_CONFLICT');
    const row = (await tx.update(campaignVersions).set({ state: input.state }).where(eq(campaignVersions.id, input.campaignVersionId)).returning())[0]!;
    await insertOutbox(tx, { aggregateType: 'campaign-version-state', aggregateId: row.id, eventType: input.state === 'APROVADA' ? 'CAMPAIGN_VERSION_APPROVED' : 'CAMPAIGN_VERSION_STATE_CHANGED', payload, idempotencyKey: input.idempotencyKey, fingerprint });
    return { data: row, replayed: false };
  });
}

export async function reserveSimulatedRecipient(db: Database, input: Parameters<typeof createRecipientWithOutbox>[1]) {
  return createRecipientWithOutbox(db, { ...input, eventType: 'SIMULATED_RECIPIENT_RESERVED', requireActiveApproved: true });
}

export const listEligibleCampaignLeads = (db: Database, channel: CampaignChannel, limit: number, offset: number) => db
  .selectDistinctOn([leads.id], { lead: leads, contact: leadContacts }).from(leads)
  .innerJoin(leadContacts, and(eq(leadContacts.leadId, leads.id), eq(leadContacts.isValid, true), sql`${leadContacts.verifiedAt} is not null`, channel === 'EMAIL' ? eq(leadContacts.type, 'EMAIL') : or(eq(leadContacts.type, 'WHATSAPP'), and(eq(leadContacts.type, 'TELEFONE'), eq(leadContacts.possibleWhatsapp, true)))))
  .where(and(eq(leads.qualificationStatus, 'SEM_SITE_CONFIRMADO'), eq(leads.isBlocked, false), eq(leads.doNotContact, false), sql`${leads.crmStage} is distinct from 'NAO_CONTATAR'::crm_stage`, sql`not exists (select 1 from campaign_opt_outs o where o.lead_id = ${leads.id} and (o.channel is null or o.channel = ${channel}))`))
  .orderBy(asc(leads.id), desc(leadContacts.verifiedAt), asc(leadContacts.id)).limit(Math.min(100, Math.max(1, limit))).offset(Math.max(0, offset));
export const listCampaignRecipients = (db: Database, campaignId: string, limit: number, offset: number) => db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaignId)).orderBy(desc(campaignRecipients.createdAt), desc(campaignRecipients.id)).limit(limit).offset(offset);
export const listRecipientAttempts = (db: Database, recipientId: string, limit: number, offset: number) => db.select().from(campaignAttempts).where(eq(campaignAttempts.recipientId, recipientId)).orderBy(desc(campaignAttempts.createdAt), desc(campaignAttempts.id)).limit(limit).offset(offset);
export const listCampaignFailures = (db: Database, limit: number, offset: number) => db.select().from(campaignDeadLetters).orderBy(desc(campaignDeadLetters.createdAt), desc(campaignDeadLetters.id)).limit(limit).offset(offset);
export const listCampaignAudit = (db: Database, aggregateId: string, limit: number, offset: number) => db.select().from(campaignOutbox).where(eq(campaignOutbox.aggregateId, aggregateId)).orderBy(desc(campaignOutbox.createdAt), desc(campaignOutbox.id)).limit(limit).offset(offset);
