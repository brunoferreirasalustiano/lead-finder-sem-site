import {
  claimCollection,
  createDatabase,
  finishCollection,
  insertLeads,
} from '@lead-finder/database';
import { calculateLeadScore } from '@lead-finder/lead-scoring';
import { OverpassClient } from '@lead-finder/overpass-client';
import { collectSchema, parseWorkerConfig } from '@lead-finder/shared';
const config = parseWorkerConfig(process.env);
const { db, close } = createDatabase(config.DATABASE_URL);
const overpass = new OverpassClient({
  endpoint: config.OVERPASS_URL,
  timeoutMs: config.OVERPASS_TIMEOUT_MS,
  maxRetries: config.OVERPASS_MAX_RETRIES,
});
let running = true;
let shutdownPromise: Promise<void> | undefined;
const shutdown = (exitCode = 0) => {
  running = false;
  process.exitCode = exitCode;
  shutdownPromise ??= close();
  return shutdownPromise;
};
const fatal = (kind: string, error: unknown) => {
  console.error(kind, error);
  void shutdown(1);
};
const requestGracefulStop = () => {
  running = false;
};
process.on('SIGTERM', requestGracefulStop);
process.on('SIGINT', requestGracefulStop);
process.on('unhandledRejection', (error) => fatal('Unhandled rejection', error));
process.on('uncaughtException', (error) => fatal('Uncaught exception', error));
while (running) {
  const job = await claimCollection(db);
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS));
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
await shutdown();
