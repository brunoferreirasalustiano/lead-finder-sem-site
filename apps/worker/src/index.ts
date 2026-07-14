import { createDatabase } from '@lead-finder/database';
import { OverpassClient } from '@lead-finder/overpass-client';
import { parseWorkerConfig } from '@lead-finder/shared';
import { processNextJob } from './process-job.js';
import { processNextOutbox } from './process-outbox.js';
import { SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';
import { hostname } from 'node:os';
import { createGracefulStop } from './graceful-stop.js';
const config = parseWorkerConfig(process.env);
const { db, close } = createDatabase(config.DATABASE_URL);
const overpass = new OverpassClient({
  endpoint: config.OVERPASS_URL,
  timeoutMs: config.OVERPASS_TIMEOUT_MS,
  maxRetries: config.OVERPASS_MAX_RETRIES,
});
const outboxAdapter = new SimulatedOutboxAdapter(db);
const workerId = config.WORKER_ID ?? `${hostname()}:${process.pid}`;
const executionPolicy = {
  dailyLimitEmail: config.CAMPAIGN_DAILY_LIMIT_EMAIL,
  dailyLimitWhatsapp: config.CAMPAIGN_DAILY_LIMIT_WHATSAPP,
  windowStartUtc: config.CAMPAIGN_WINDOW_START_UTC,
  windowEndUtc: config.CAMPAIGN_WINDOW_END_UTC,
  minSpacingMs: config.CAMPAIGN_MIN_SPACING_MS,
  maxAttempts: config.OUTBOX_RETRY_MAX_ATTEMPTS,
  retryBaseMs: config.OUTBOX_RETRY_BASE_MS,
  retryMaxMs: config.OUTBOX_RETRY_MAX_MS,
};
const operationalLogger = {
  info: (event: string, metadata: Record<string, string | number | boolean>) => console.info(event, metadata),
  error: (event: string, metadata: Record<string, string | number | boolean>) => console.error(event, metadata),
};
const gracefulStop = createGracefulStop();
let shutdownPromise: Promise<void> | undefined;
const shutdown = (exitCode = 0) => {
  gracefulStop.request();
  process.exitCode = exitCode;
  shutdownPromise ??= close();
  return shutdownPromise;
};
const fatal = (kind: string, error: unknown) => {
  void error;
  console.error('worker_fatal', { kind, decision: 'SHUTDOWN_REQUESTED' });
  process.exitCode = 1;
  gracefulStop.request();
};
const requestGracefulStop = () => {
  gracefulStop.request();
};
process.on('SIGTERM', requestGracefulStop);
process.on('SIGINT', requestGracefulStop);
process.on('unhandledRejection', (error) => fatal('Unhandled rejection', error));
process.on('uncaughtException', (error) => fatal('Uncaught exception', error));
while (gracefulStop.running) {
  const collected = await processNextJob(db, overpass);
  const consumedOutbox = gracefulStop.running
    ? await processNextOutbox(db, outboxAdapter, {
      workerId, leaseMs: config.OUTBOX_LEASE_MS, policy: executionPolicy,
    }, operationalLogger)
    : false;
  if (!collected && !consumedOutbox && gracefulStop.running) {
    await gracefulStop.wait(config.WORKER_POLL_INTERVAL_MS);
  }
}
await shutdown();
