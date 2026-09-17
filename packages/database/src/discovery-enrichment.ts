import { and, eq, or, sql } from 'drizzle-orm';
import type { NormalizedLead } from '@lead-finder/shared';
import type { Database } from './index.js';
import { leads } from './schema.js';

export interface LeadEnrichmentState {
  osmType: string;
  osmId: string;
  websiteStatus: 'UNKNOWN' | 'OFFICIAL_SITE_FOUND' | 'NO_OFFICIAL_SITE_CONFIRMED';
  isBlocked: boolean;
  doNotContact: boolean;
  isClosed: boolean;
  crmStage: string | null;
  lastEnrichedAt: Date | null;
  latestWebsiteEvidenceSource: string | null;
}

const osmIdentityPredicate = (identities: readonly Pick<NormalizedLead, 'osmType' | 'osmId'>[]) => {
  const unique = new Map(
    identities.map((identity) => [`${identity.osmType}:${identity.osmId}`, identity]),
  );
  const predicates = [...unique.values()].map((identity) =>
    and(eq(leads.osmType, identity.osmType), eq(leads.osmId, identity.osmId)),
  );
  return predicates.length === 0 ? undefined : or(...predicates);
};

export async function listLeadEnrichmentStates(
  db: Database,
  identities: readonly Pick<NormalizedLead, 'osmType' | 'osmId'>[],
): Promise<LeadEnrichmentState[]> {
  const predicate = osmIdentityPredicate(identities);
  if (!predicate) return [];
  return db
    .select({
      osmType: leads.osmType,
      osmId: leads.osmId,
      websiteStatus: leads.websiteStatus,
      isBlocked: leads.isBlocked,
      doNotContact: leads.doNotContact,
      isClosed: leads.isClosed,
      crmStage: leads.crmStage,
      lastEnrichedAt: sql<Date | null>`(
      SELECT max(e.created_at)
      FROM public.lead_evidence e
      WHERE e.lead_id = ${leads.id}
        AND e.evidence_type IN ('BUSINESS_IDENTITY','BUSINESS_ACTIVITY','WEBSITE','BUSINESS_EMAIL')
    )`,
      latestWebsiteEvidenceSource: sql<string | null>`(
      SELECT e.source
      FROM public.lead_evidence e
      WHERE e.lead_id = ${leads.id}
        AND e.evidence_type = 'WEBSITE'
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1
    )`,
    })
    .from(leads)
    .where(predicate);
}

export async function fillMissingLeadCollectionLocation(
  db: Database,
  identities: readonly Pick<NormalizedLead, 'osmType' | 'osmId'>[],
  area: { city: string; state: string },
): Promise<void> {
  const predicate = osmIdentityPredicate(identities);
  if (!predicate) return;
  await db
    .update(leads)
    .set({
      city: sql`coalesce(${leads.city}, ${area.city})`,
      state: sql`coalesce(${leads.state}, ${area.state})`,
    })
    .where(predicate);
}
