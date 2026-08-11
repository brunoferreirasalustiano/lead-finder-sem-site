import {
  claimCollection,
  finishCollection,
  getLeadByOsmIdentity,
  recordLeadEnrichment,
  insertLeads,
  type Database,
} from '@lead-finder/database';
import { calculateLeadScore } from '@lead-finder/lead-scoring';
import type { OverpassClient } from '@lead-finder/overpass-client';
import type { BusinessContactEnrichmentProvider } from '@lead-finder/enrichment';
import { collectSchema } from '@lead-finder/shared';

export async function processNextJob(
  db: Database,
  overpass: OverpassClient,
  enrichmentProvider?: BusinessContactEnrichmentProvider,
  maxEnrichmentCandidates = 10,
  maxCandidatesPerJob = 50,
): Promise<boolean> {
  const job = await claimCollection(db);
  if (!job) return false;
  try {
    const input = collectSchema.parse(job.payload);
    const normalized = (await overpass.collect(input)).slice(0, maxCandidatesPerJob);
    await insertLeads(db, normalized.map((lead) => ({ ...lead, score: calculateLeadScore(lead) })));
    if (enrichmentProvider) {
      for (const lead of normalized.slice(0, maxEnrichmentCandidates)) {
        const persisted = await getLeadByOsmIdentity(db, lead.osmType, lead.osmId);
        if (!persisted) continue;
        const result = await enrichmentProvider.enrich({ lead });
        await recordLeadEnrichment(db, persisted.id, result);
      }
    }
    await finishCollection(db, job.id, undefined, job.leaseToken);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'COLLECTION_FAILED';
    await finishCollection(db, job.id, code, job.leaseToken);
  }
  return true;
}
