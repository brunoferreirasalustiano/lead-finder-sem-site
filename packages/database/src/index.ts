import { and, count, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  normalizeAddress,
  normalizeBusinessName,
  type LeadStatus,
  type NormalizedLead,
} from '@lead-finder/shared';
import { collectionJobs, leads, type NewLead } from './schema.js';
export * from './schema.js';
export * from './qualification.js';
export * from './crm.js';
export * from './campaign.js';

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
export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, idle_timeout: 20 });
  return { db: drizzle(client), close: () => client.end() };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export async function checkDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
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
      .select()
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
  return (await db.select().from(leads).where(eq(leads.id, id)).limit(1))[0] ?? null;
}
export async function enqueueCollection(db: Database, payload: unknown) {
  return (
    await db
      .insert(collectionJobs)
      .values({ payload })
      .returning({ id: collectionJobs.id, status: collectionJobs.status })
  )[0];
}
export async function claimCollection(db: Database) {
  return db.transaction(async (tx) => {
    const job = (
      await tx
        .select()
        .from(collectionJobs)
        .where(eq(collectionJobs.status, 'PENDING'))
        .orderBy(collectionJobs.createdAt)
        .limit(1)
        .for('update', { skipLocked: true })
    )[0];
    if (!job) return null;
    await tx
      .update(collectionJobs)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(eq(collectionJobs.id, job.id));
    return job;
  });
}
export async function finishCollection(db: Database, id: string, error?: string) {
  await db
    .update(collectionJobs)
    .set({ status: error ? 'FAILED' : 'COMPLETED', error: error ?? null, updatedAt: new Date() })
    .where(eq(collectionJobs.id, id));
}
