import { createDatabase } from '@lead-finder/database';
import { OverpassClient } from '@lead-finder/overpass-client';
import { parseWorkerConfig } from '@lead-finder/shared';
import { processNextJob } from './process-job.js';
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
  if (!(await processNextJob(db, overpass))) {
    await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS));
  }
}
await shutdown();
