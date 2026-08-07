import { and, count, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { MessagingChannel } from '@lead-finder/messaging';
import {
  normalizeAddress,
  normalizeBusinessName,
  type AuthorizationContext,
  type LeadStatus,
  type NormalizedLead,
} from '@lead-finder/shared';
import { collectionJobs, leads, type NewLead } from './schema.js';
import { safeLeadSelection } from './safe-projections.js';
import {
  prepareManualMessage as prepareLegacyManualMessage,
  recordManualOpen as recordLegacyManualOpen,
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
} from './restricted-manual-email.js';
export * from './operator-channel-test.js';
export * from './operator-email-test.js';
export * from './deployment-processing.js';
export * from './prospecting-metrics.js';

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
    return recordLegacyManualOpen(db, preparationId, input, auth);
  }
  return recordRestrictedManualOpen(db, preparationId, input, auth);
}

export async function checkDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
export async function checkExpectedMigration(
  db: Database,
  version = '0028_prospecting_runtime_deny_all_reconciliation',
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
  const values: NewLead[] = uniqueByOsm(input).map((lead) => ({
    ...lead,
    latitude: lead.latitude?.toString(),
    longitude: lead.longitude?.toString(),
    status: deriveStatus(lead),
    normalizedName: lead.name ? normalizeBusinessName(lead.name) || null : null,
    normalizedAddress: lead.address ? normalizeAddress(lead.address) || null : null,
  }));
  if (values.length === 0) return 0;
  return (await db.insert(leads).values(values).onConflictDoNothing().returning({ id: leads.id }))
    .length;
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
export interface CollectionEgressAuthorization {
  enabled: true;
  configurationVersion: 1;
}

const collectionAuthorization = { enabled: true, configurationVersion: 1 } as const;

export async function enqueueCollection(
  db: Database,
  payload: unknown,
  authorization?: CollectionEgressAuthorization,
) {
  if (authorization?.enabled !== true || authorization.configurationVersion !== 1) {
    throw new Error('COLLECTION_EGRESS_DISABLED');
  }
  return (
    await db
      .insert(collectionJobs)
      .values({ payload: { input: payload, collectionEgress: collectionAuthorization } })
      .returning({ id: collectionJobs.id, status: collectionJobs.status })
  )[0];
}
export async function claimCollection(db: Database) {
  return db.transaction(async (tx) => {
    const job = (
      await tx
        .select()
        .from(collectionJobs)
        .where(and(
          eq(collectionJobs.status, 'PENDING'),
          sql`${collectionJobs.payload} @> ${JSON.stringify({ collectionEgress: collectionAuthorization })}::jsonb`,
        ))
        .orderBy(collectionJobs.createdAt)
        .limit(1)
        .for('update', { skipLocked: true })
    )[0];
    if (!job) return null;
    await tx
      .update(collectionJobs)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(eq(collectionJobs.id, job.id));
    const envelope = job.payload as { input: unknown };
    return { ...job, payload: envelope.input };
  });
}
export async function finishCollection(db: Database, id: string, error?: string) {
  await db
    .update(collectionJobs)
    .set({ status: error ? 'FAILED' : 'COMPLETED', error: error ?? null, updatedAt: new Date() })
    .where(eq(collectionJobs.id, id));
}
