import { createHash } from 'node:crypto';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { CampaignChannel, CampaignRecipientState } from '@lead-finder/shared';
import type { Database } from './index.js';
import {
  campaignAttempts, campaignDeadLetters, campaignOptOuts, campaignOutbox,
  campaignProviderEvents, campaignRecipients, campaigns, campaignTemplates, campaignVersions,
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
}) {
  const payload = { campaignId: input.campaignId, campaignVersionId: input.campaignVersionId, leadId: input.leadId, channel: input.channel, snapshot: input.snapshot };
  const fingerprint = persistenceFingerprint(payload);
  try {
    return await db.transaction(async (tx) => {
      await lock(tx, `campaign:${input.campaignId}:recipient`, input.idempotencyKey);
      const existing = (await tx.select().from(campaignRecipients).where(and(
        eq(campaignRecipients.campaignId, input.campaignId), eq(campaignRecipients.idempotencyKey, input.idempotencyKey),
      )).limit(1))[0];
      if (existing) { assertFingerprint(existing.payloadFingerprint, fingerprint); return { data: existing, replayed: true }; }
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
  const fingerprint = persistenceFingerprint(payload);
  return db.transaction(async (tx) => {
    await lock(tx, `recipient:${input.recipientId}:attempt`, input.idempotencyKey);
    const existing = (await tx.select().from(campaignAttempts).where(and(
      eq(campaignAttempts.recipientId, input.recipientId), eq(campaignAttempts.idempotencyKey, input.idempotencyKey),
    )).limit(1))[0];
    if (existing) { assertFingerprint(existing.payloadFingerprint, fingerprint); return { data: existing, replayed: true }; }
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

export async function moveOutboxToDeadLetter(db: Database, input: { outboxId: string; correlationId: string; error: string; attempts: number }) {
  return db.transaction(async (tx) => {
    const outbox = (await tx.select().from(campaignOutbox).where(eq(campaignOutbox.id, input.outboxId)).for('update').limit(1))[0];
    if (!outbox) throw new CampaignPersistenceError('Outbox record not found', 'NOT_FOUND');
    const existing = (await tx.select().from(campaignDeadLetters).where(eq(campaignDeadLetters.outboxId, input.outboxId)).limit(1))[0];
    if (existing) return { data: existing, replayed: true };
    await tx.update(campaignOutbox).set({ status: 'FAILED', attempts: input.attempts }).where(eq(campaignOutbox.id, input.outboxId));
    const row = (await tx.insert(campaignDeadLetters).values({ outboxId: input.outboxId, correlationId: input.correlationId, payload: outbox.payload, error: input.error, attempts: input.attempts }).returning())[0]!;
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
