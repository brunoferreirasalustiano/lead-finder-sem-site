import { and, count, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import type { MessagingChannel } from '@lead-finder/messaging';
import {
  normalizeAddress,
  normalizeBusinessName,
  collectionRequestIdentitySchema,
  parseCollectionRequestIdentity,
  type AuthorizationContext,
  type LeadStatus,
  type NormalizedLead,
} from '@lead-finder/shared';
import { collectionJobs, leads, type NewLead } from './schema.js';
import { safeLeadSelection } from './safe-projections.js';
import {
  prepareManualMessage as prepareLegacyManualMessage,
} from './manual-messaging.js';
import {
  prepareManualMessage as prepareRestrictedManualMessage,
  recordManualOpen as recordRestrictedManualOpen,
} from './restricted-manual-email.js';
export * from './schema.js';
export * from './safe-projections.js';
export * from './crm-mutation-projections.js';
export * from './qualification.js';
export * from './crm.js';
export * from './campaign.js';
export * from './campaign-outbox.js';
export * from './operational-observability.js';
export * from './pilot.js';
export * from './manual-messaging.js';
export {
  sendPreparedManualEmail,
  type RestrictedManualEmailDeliveryResult,
  type Daily6EmailRuntime,
  type Daily6GmailSentSearch,
  type Daily6GmailSentSearchResult,
} from './restricted-manual-email.js';
export * from './operator-channel-test.js';
export * from './operator-email-test.js';
export * from './hml-suppression-probe.js';
export * from './deployment-processing.js';
export * from './prospecting-metrics.js';
export * from './enrichment.js';
export * from './daily6.js';
export * from './daily6-whatsapp-opportunities.js';
export * from './daily6-orchestrator.js';

export const deriveStatus = (lead: NormalizedLead): LeadStatus =>
  lead.isClosed
    ? 'INVALIDO'
    : lead.website
      ? 'POSSUI_SITE'
      : lead.phone || lead.whatsapp || lead.email || lead.instagram
        ? 'SEM_SITE_CADASTRADO'
        : 'PROVAVELMENTE_SEM_SITE';
export const uniqueByOsm = <T extends Pick<NormalizedLead, 'osmType' | 'osmId'>>(items: T[]): T[] =>
  Array.from(new Map(items.map((item) => [`${item.osmType}:${item.osmId}`, item])).values());
export function createDatabase(databaseUrl: string, options: { max?: number; ssl?: 'disable' | 'require' | 'verify-full' } = {}) {
  const ssl = options.ssl === 'disable' ? false : options.ssl === 'require' ? 'require' : options.ssl === 'verify-full' ? 'verify-full' : undefined;
  const client = postgres(databaseUrl, { max: options.max ?? 10, idle_timeout: 20, connect_timeout: 10, ...(ssl === undefined ? {} : { ssl }) });
  return { db: drizzle(client), close: () => client.end() };
}
export type Database = ReturnType<typeof createDatabase>['db'];

export async function prepareManualMessage(
  db: Database,
  pilotRunId: string,
  leadId: string,
  input: {
    contactId: string;
    requestedChannel: MessagingChannel;
    templateId: string;
    templateVersion: string;
    idempotencyKey: string;
  },
  auth: AuthorizationContext,
) {
  if (input.requestedChannel !== 'EMAIL' || !auth.permissions.has('manual-messaging:send')) {
    return prepareLegacyManualMessage(db, pilotRunId, leadId, input, auth);
  }
  return prepareRestrictedManualMessage(db, pilotRunId, leadId, input, auth);
}

export async function recordManualOpen(
  db: Database,
  preparationId: string,
  input: { idempotencyKey: string },
  auth: AuthorizationContext,
) {
  if (!auth.permissions.has('manual-messaging:open')) {
    throw new Error('MANUAL_MESSAGING_OPEN_PERMISSION_REQUIRED');
  }
  return recordRestrictedManualOpen(db, preparationId, input, auth);
}

export async function checkDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
export async function checkExpectedMigration(
  db: Pick<Database, 'execute'>,
  version = '0049_precontact_email_existing_duplicate_hardening',
): Promise<void> {
  const localRows = await db.execute<{ version: string }>(sql`
    SELECT version
    FROM public.schema_migrations
    WHERE version = ${version}
  `);
  if (localRows.length === 1) return;

  const registryRows = await db.execute<{ exists: boolean }>(sql`
    SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists
  `);
  if (registryRows[0]?.exists) {
    const supabaseRows = await db.execute<{ name: string }>(sql`
      SELECT name::text AS name
      FROM supabase_migrations.schema_migrations
      WHERE name = ${version}
    `);
    if (supabaseRows.length === 1) return;
  }
  throw new Error('EXPECTED_MIGRATION_MISSING');
}
export async function insertLeads(
  db: Database,
  input: Array<NormalizedLead & { score: number }>,
): Promise<number> {
  return (await insertLeadsReturning(db, input)).length;
}

export async function insertLeadsReturning(
  db: Database,
  input: Array<NormalizedLead & { score: number }>,
) {
  const values: NewLead[] = uniqueByOsm(input).map((lead) => ({
    ...lead,
    latitude: lead.latitude?.toString(),
    longitude: lead.longitude?.toString(),
    status: deriveStatus(lead),
    normalizedName: lead.name ? normalizeBusinessName(lead.name) || null : null,
    normalizedAddress: lead.address ? normalizeAddress(lead.address) || null : null,
    websiteStatus: lead.websiteStatus ?? 'UNKNOWN',
  }));
  if (values.length === 0) return [];
  return db.insert(leads).values(values).onConflictDoNothing().returning({
    id: leads.id,
    osmType: leads.osmType,
    osmId: leads.osmId,
  });
}
export interface LeadFilters {
  page: number;
  pageSize: number;
  status?: LeadStatus | undefined;
  category?: string | undefined;
  city?: string | undefined;
  minScore?: number | undefined;
}
const whereFor = (f: LeadFilters) => {
  const c: SQL[] = [];
  if (f.status) c.push(eq(leads.status, f.status));
  if (f.category) c.push(eq(leads.category, f.category));
  if (f.city) c.push(eq(leads.city, f.city));
  if (f.minScore !== undefined) c.push(gte(leads.score, f.minScore));
  return c.length ? and(...c) : undefined;
};
export async function listLeads(db: Database, f: LeadFilters) {
  const where = whereFor(f);
  const [items, totalRows] = await Promise.all([
    db
      .select(safeLeadSelection)
      .from(leads)
      .where(where)
      .orderBy(desc(leads.score), desc(leads.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db.select({ value: count() }).from(leads).where(where),
  ]);
  const total = totalRows[0]?.value ?? 0;
  return {
    items,
    pagination: {
      page: f.page,
      pageSize: f.pageSize,
      total,
      totalPages: Math.ceil(total / f.pageSize),
    },
  };
}
export async function getLead(db: Database, id: string) {
  return (await db.select(safeLeadSelection).from(leads).where(eq(leads.id, id)).limit(1))[0] ?? null;
}
export async function getLeadByOsmIdentity(db: Database, osmType: string, osmId: string) {
  return (await db.select(safeLeadSelection).from(leads).where(and(eq(leads.osmType, osmType), eq(leads.osmId, osmId))).limit(1))[0] ?? null;
}
export interface CollectionEgressAuthorization {
  enabled: true;
  configurationVersion: 1;
}

const collectionAuthorization = { enabled: true, configurationVersion: 1 } as const;

export async function enqueueCollection(
  db: Database,
  payload: unknown,
  authorization?: CollectionEgressAuthorization,
  requestIdentity?: string,
) {
  if (authorization?.enabled !== true || authorization.configurationVersion !== 1) {
    throw new Error('COLLECTION_EGRESS_DISABLED');
  }
  const parsedIdentity = collectionRequestIdentitySchema.safeParse(requestIdentity);
  if (!parsedIdentity.success) throw new Error('COLLECTION_IDENTITY_REQUIRED');
  if (!parseCollectionRequestIdentity(parsedIdentity.data)) throw new Error('COLLECTION_IDENTITY_REQUIRED');
  const envelope = {
    input: payload,
    collectionEgress: collectionAuthorization,
    collectionRequestIdentity: parsedIdentity.data,
  };
  const rows = await db.execute<{ id: string; status: string; replayed: boolean }>(sql`
    SELECT id, status, replayed
    FROM lead_finder_internal.enqueue_collection_job(
      ${parsedIdentity.data},
      ${JSON.stringify(envelope)}::jsonb
    )
  `);
  const row = rows[0];
  if (!row) throw new Error('COLLECTION_ENQUEUE_RESULT_MISSING');
  return { id: row.id, status: row.status, replayed: row.replayed };
}
const collectionLeaseMs = 30 * 60 * 1_000;
const collectionMaxAttempts = 3;
const safeCollectionError = (error?: string): string | null => {
  if (!error) return null;
  const code = error.split(':', 1)[0]?.trim() || 'COLLECTION_FAILED';
  return /^[A-Z0-9_]{1,80}$/u.test(code) ? code : 'COLLECTION_FAILED';
};

export async function claimCollection(db: Database, requestIdentity?: string) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const expiredTerminalJobs = await tx
      .update(collectionJobs)
      .set({
        status: sql`case when ${collectionJobs.attemptCount} >= ${collectionMaxAttempts} then 'FAILED' else 'PENDING' end`,
        error: sql`case when ${collectionJobs.attemptCount} >= ${collectionMaxAttempts} then 'COLLECTION_MAX_ATTEMPTS' else null end`,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(and(
        eq(collectionJobs.status, 'PROCESSING'),
        sql`${collectionJobs.leaseExpiresAt} is not null and ${collectionJobs.leaseExpiresAt} < ${now.toISOString()}`,
      ))
      .returning({ requestIdentity: collectionJobs.requestIdentity, status: collectionJobs.status });
    for (const expiredJob of expiredTerminalJobs) {
      if (expiredJob.status === 'FAILED' && expiredJob.requestIdentity) {
        await tx.execute(sql`
          SELECT *
          FROM lead_finder_internal.sync_daily6_batch_from_collection(${expiredJob.requestIdentity})
        `);
      }
    }
    const job = (
      await tx
        .select()
        .from(collectionJobs)
          .where(and(
            eq(collectionJobs.status, 'PENDING'),
            sql`${collectionJobs.attemptCount} < ${collectionMaxAttempts}`,
            sql`${collectionJobs.payload} @> ${JSON.stringify({ collectionEgress: collectionAuthorization })}::jsonb`,
            ...(requestIdentity === undefined ? [] : [eq(collectionJobs.requestIdentity, requestIdentity)]),
          ))
        .orderBy(collectionJobs.createdAt)
        .limit(1)
        .for('update', { skipLocked: true })
    )[0];
    if (!job) return null;
    const leaseToken = randomUUID();
    await tx
      .update(collectionJobs)
      .set({ status: 'PROCESSING', leaseToken, leaseExpiresAt: new Date(now.valueOf() + collectionLeaseMs), attemptCount: sql`${collectionJobs.attemptCount} + 1`, updatedAt: now })
      .where(eq(collectionJobs.id, job.id));
    const envelope = job.payload as { input: unknown };
    return { ...job, payload: envelope.input, leaseToken };
  });
}
export async function finishCollection(db: Database, id: string, error?: string, leaseToken?: string) {
  await db.transaction(async (tx) => {
    const result = await tx
      .update(collectionJobs)
      .set({ status: error ? 'FAILED' : 'COMPLETED', error: safeCollectionError(error), leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(collectionJobs.id, id), eq(collectionJobs.status, 'PROCESSING'), ...(leaseToken ? [eq(collectionJobs.leaseToken, leaseToken)] : [])))
      .returning({ id: collectionJobs.id, requestIdentity: collectionJobs.requestIdentity });
    if (leaseToken && result.length !== 1) throw new Error('COLLECTION_LEASE_LOST');
    if (error && result[0]?.requestIdentity) {
      await tx.execute(sql`
        SELECT *
        FROM lead_finder_internal.sync_daily6_batch_from_collection(${result[0].requestIdentity})
      `);
    }
  });
}

/**
 * Extends an active collection lease while its bounded worker is still the
 * owner. A fenced or already-expired lease is never revived.
 */
export async function renewCollectionLease(db: Database, id: string, leaseToken: string): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(collectionJobs)
    .set({ leaseExpiresAt: new Date(now.valueOf() + collectionLeaseMs), updatedAt: now })
    .where(and(
      eq(collectionJobs.id, id),
      eq(collectionJobs.status, 'PROCESSING'),
      eq(collectionJobs.leaseToken, leaseToken),
      sql`${collectionJobs.leaseExpiresAt} > ${now.toISOString()}`,
    ))
    .returning({ id: collectionJobs.id });
  return result.length === 1;
}
