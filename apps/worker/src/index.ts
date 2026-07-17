import { createDatabase } from '@lead-finder/database';
import { parseWorkerConfig, ShadowModeGuard } from '@lead-finder/shared';
import { createCollectionProcessor } from './collection-egress.js';
import { processNextOutbox } from './process-outbox.js';
import { SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';
import { hostname } from 'node:os';
import { createGracefulStop } from './graceful-stop.js';
import { createConsoleOperationalLogger, OperationalMetrics } from './operational-observability.js';
const config = parseWorkerConfig(process.env);
const { db, close } = createDatabase(config.DATABASE_URL);
const operationalLogger = createConsoleOperationalLogger();
const processCollection = createCollectionProcessor(db, {
  enabled: config.COLLECTION_EGRESS_ENABLED && !config.PILOT_KILL_SWITCH_ENABLED,
  endpoint: config.OVERPASS_API_URL,
  timeoutMs: config.OVERPASS_TIMEOUT_MS,
  maxRetries: config.OVERPASS_MAX_RETRIES,
}, operationalLogger);
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
const operationalMetrics = new OperationalMetrics();
const shadowGuard = new ShadowModeGuard(config.SHADOW_MODE_ENABLED, { info: (event, metadata) => operationalLogger.info({ correlationId: String(metadata.runId), event, outcome: 'INELIGIBLE', reason: 'UNKNOWN', durationMs: Number(metadata.durationMs ?? 0) }) });
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
  const collected = await processCollection();
  const consumedOutbox = gracefulStop.running
    ? await processNextOutbox(db, outboxAdapter, {
      workerId, leaseMs: config.OUTBOX_LEASE_MS, policy: executionPolicy, shadowGuard,
      killSwitchEnabled: config.PILOT_KILL_SWITCH_ENABLED,
    }, operationalLogger, operationalMetrics)
    : false;
  if (!collected && !consumedOutbox && gracefulStop.running) {
    await gracefulStop.wait(config.WORKER_POLL_INTERVAL_MS);
  }
}
await shutdown();
