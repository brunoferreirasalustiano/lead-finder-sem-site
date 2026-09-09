import {
  claimCollection,
  finishCollection,
  fillMissingLeadCollectionLocation,
  getLeadByOsmIdentity,
  listLeadEnrichmentStates,
  type LeadEnrichmentState,
  recordLeadEnrichment,
  insertLeads,
  renewCollectionLease,
  type Database,
} from '@lead-finder/database';
import { calculateLeadScore } from '@lead-finder/lead-scoring';
import type { OverpassClient } from '@lead-finder/overpass-client';
import { EnrichmentError, type BusinessContactEnrichmentProvider } from '@lead-finder/enrichment';
import { collectSchema, type NormalizedLead } from '@lead-finder/shared';

export type CollectionFailureTelemetry = {
  code: string;
  provider?: string;
  retryAfterSeconds?: number;
};

const identityKey = (value: { osmType: string; osmId: string }) => `${value.osmType}:${value.osmId}`;
const present = (value: string | null | undefined) => Boolean(value?.trim());

export function applyCollectionAreaDefaults(
  area: { city: string; state: string },
  leads: readonly NormalizedLead[],
): NormalizedLead[] {
  return leads.map((lead) => ({
    ...lead,
    city: present(lead.city) ? lead.city : area.city,
    state: present(lead.state) ? lead.state : area.state,
  }));
}

export function selectEnrichmentCandidates(
  candidates: readonly NormalizedLead[],
  states: readonly LeadEnrichmentState[],
  limit: number,
): NormalizedLead[] {
  const byIdentity = new Map(states.map((state) => [identityKey(state), state]));
  const uniqueCandidates = new Map(candidates.map((candidate) => [identityKey(candidate), candidate]));
  return [...uniqueCandidates.values()]
    .filter((candidate) => {
      const state = byIdentity.get(identityKey(candidate));
      return state !== undefined
        && !candidate.isClosed
        && candidate.websiteStatus !== 'OFFICIAL_SITE_FOUND'
        && !state.isBlocked
        && !state.doNotContact
        && !state.isClosed
        && state.crmStage !== 'NAO_CONTATAR'
        && state.websiteStatus !== 'OFFICIAL_SITE_FOUND';
    })
    .sort((left, right) => {
      const leftAt = byIdentity.get(identityKey(left))?.lastEnrichedAt?.valueOf() ?? Number.NEGATIVE_INFINITY;
      const rightAt = byIdentity.get(identityKey(right))?.lastEnrichedAt?.valueOf() ?? Number.NEGATIVE_INFINITY;
      return leftAt - rightAt || identityKey(left).localeCompare(identityKey(right));
    })
    .slice(0, Math.max(0, limit));
}

export async function processNextJob(
  db: Database,
  overpass: OverpassClient,
  enrichmentProvider?: BusinessContactEnrichmentProvider,
  maxEnrichmentCandidates = 10,
  maxCandidatesPerJob = 50,
  onFailure?: (telemetry: CollectionFailureTelemetry) => void,
  requestIdentity?: string,
): Promise<boolean> {
  const job = await claimCollection(db, requestIdentity);
  if (!job) return false;
  let providerCallInFlight = false;
  try {
    const input = collectSchema.parse(job.payload);
    const normalized = applyCollectionAreaDefaults(
      input,
      (await overpass.collect(input)).slice(0, maxCandidatesPerJob),
    );
    await insertLeads(db, normalized.map((lead) => ({ ...lead, score: calculateLeadScore(lead) })));
    await fillMissingLeadCollectionLocation(db, normalized, input);
    if (enrichmentProvider) {
      const states = await listLeadEnrichmentStates(db, normalized);
      const enrichmentCandidates = selectEnrichmentCandidates(normalized, states, maxEnrichmentCandidates);
      for (const lead of enrichmentCandidates) {
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
