import {
  claimCollection,
  finishCollection,
  insertLeads,
  type Database,
} from '@lead-finder/database';
import { calculateLeadScore } from '@lead-finder/lead-scoring';
import type { OverpassClient } from '@lead-finder/overpass-client';
import { collectSchema } from '@lead-finder/shared';

export async function processNextJob(db: Database, overpass: OverpassClient): Promise<boolean> {
  const job = await claimCollection(db);
  if (!job) return false;
  try {
    const input = collectSchema.parse(job.payload);
    const normalized = await overpass.collect(input);
    await insertLeads(
      db,
      normalized.map((lead) => ({ ...lead, score: calculateLeadScore(lead) })),
    );
    await finishCollection(db, job.id);
  } catch (error) {
    await finishCollection(db, job.id, error instanceof Error ? error.message : 'Unknown error');
  }
  return true;
}
