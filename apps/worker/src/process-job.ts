import {
  claimCollection,
  finishCollection,
  getLeadByOsmIdentity,
  recordLeadEnrichment,
  insertLeads,
  renewCollectionLease,
  type Database,
} from '@lead-finder/database';
import { calculateLeadScore } from '@lead-finder/lead-scoring';
import type { OverpassClient } from '@lead-finder/overpass-client';
import { EnrichmentError, type BusinessContactEnrichmentProvider } from '@lead-finder/enrichment';
import { collectSchema } from '@lead-finder/shared';

export type CollectionFailureTelemetry = {
  code: string;
  provider?: string;
  retryAfterSeconds?: number;
};

export async function processNextJob(
  db: Database,
  overpass: OverpassClient,
  enrichmentProvider?: BusinessContactEnrichmentProvider,
  maxEnrichmentCandidates = 10,
  maxCandidatesPerJob = 50,
  onFailure?: (telemetry: CollectionFailureTelemetry) => void,
): Promise<boolean> {
  const job = await claimCollection(db);
  if (!job) return false;
  let providerCallInFlight = false;
  try {
    const input = collectSchema.parse(job.payload);
    const normalized = (await overpass.collect(input)).slice(0, maxCandidatesPerJob);
    await insertLeads(db, normalized.map((lead) => ({ ...lead, score: calculateLeadScore(lead) })));
    if (enrichmentProvider) {
      for (const lead of normalized.slice(0, maxEnrichmentCandidates)) {
        if (!(await renewCollectionLease(db, job.id, job.leaseToken))) throw new Error('COLLECTION_LEASE_LOST');
        const persisted = await getLeadByOsmIdentity(db, lead.osmType, lead.osmId);
        if (!persisted) continue;
        providerCallInFlight = true;
        const result = await enrichmentProvider.enrich({ lead });
        providerCallInFlight = false;
        await recordLeadEnrichment(db, persisted.id, result);
      }
      if (!(await renewCollectionLease(db, job.id, job.leaseToken))) throw new Error('COLLECTION_LEASE_LOST');
    }
    await finishCollection(db, job.id, undefined, job.leaseToken);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'COLLECTION_FAILED';
    const retryAfterSeconds = error instanceof EnrichmentError ? error.retryAfterSeconds : undefined;
    onFailure?.({
      code,
      ...(enrichmentProvider === undefined || !providerCallInFlight ? {} : { provider: enrichmentProvider.name }),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
    if (code === 'COLLECTION_LEASE_LOST') throw error;
    await finishCollection(db, job.id, code, job.leaseToken);
  }
  return true;
}
