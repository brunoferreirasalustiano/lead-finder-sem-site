import {
  claimCollection,
  createDatabase,
  finishCollection,
  insertLeads,
} from '@lead-finder/database';
import { calculateLeadScore } from '@lead-finder/lead-scoring';
import { OverpassClient } from '@lead-finder/overpass-client';
import { collectSchema } from '@lead-finder/shared';
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const { db, close } = createDatabase(databaseUrl);
const overpass = new OverpassClient({
  endpoint: process.env['OVERPASS_URL'] ?? 'https://overpass-api.de/api/interpreter',
  timeoutMs: Number(process.env['OVERPASS_TIMEOUT_MS'] ?? 30000),
  maxRetries: Number(process.env['OVERPASS_MAX_RETRIES'] ?? 3),
});
const interval = Math.max(1000, Number(process.env['WORKER_POLL_INTERVAL_MS'] ?? 60000));
let running = true;
const shutdown = () => {
  running = false;
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
while (running) {
  const job = await claimCollection(db);
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    continue;
  }
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
}
await close();
