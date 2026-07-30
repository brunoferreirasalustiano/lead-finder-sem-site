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
import { safeLeadSelection } from './safe-projections.js';
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
export * from './operator-channel-test.js';
export * from './deployment-processing.js';

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
export async function checkDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
export async function checkExpectedMigration(db: Database, version = '0026_narrow_contact_resolution_hardening'): Promise<void> {
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
  return { items, total, page: f.page, pageSize: f.pageSize };
}
