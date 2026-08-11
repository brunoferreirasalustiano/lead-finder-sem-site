import { createDatabase } from '@lead-finder/database';
import { createDryRunItemProcessor, processLeadBatch } from '@lead-finder/batch-processor';
import { parseWorkerConfig, ShadowModeGuard } from '@lead-finder/shared';
import { createCollectionProcessor } from './collection-egress.js';
import {
  CnpjWsBusinessRegistryProvider,
  CompositeBusinessEnrichmentProvider,
  DisabledBusinessEnrichmentProvider,
  HttpBusinessEnrichmentProvider,
  TavilyBusinessSearchProvider,
  type BusinessContactEnrichmentProvider,
} from '@lead-finder/enrichment';
import { processNextJob } from './process-job.js';
import { hostname } from 'node:os';
import { createGracefulStop } from './graceful-stop.js';
import { createConsoleOperationalLogger } from './operational-observability.js';
import { runOneShot } from './oneshot.js';
const config = parseWorkerConfig(process.env);
const { db, close } = createDatabase(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX, ssl: config.DATABASE_SSL_MODE });
const operationalLogger = createConsoleOperationalLogger();
const enrichmentProvider: BusinessContactEnrichmentProvider | undefined = config.ENRICHMENT_EGRESS_ENABLED
  ? config.ENRICHMENT_PROVIDER === 'composite'
    ? config.TAVILY_API_KEY
      ? new CompositeBusinessEnrichmentProvider({
          searchProvider: new TavilyBusinessSearchProvider({
            apiKey: config.TAVILY_API_KEY,
            timeoutMs: config.ENRICHMENT_TIMEOUT_MS,
            maxQueries: config.TAVILY_MAX_QUERIES_PER_CANDIDATE,
            maxResultsPerQuery: config.TAVILY_MAX_RESULTS_PER_QUERY,
            maxRetries: config.TAVILY_MAX_RETRIES,
            minIntervalMs: config.TAVILY_MIN_INTERVAL_MS,
          }),
          registryProvider: new CnpjWsBusinessRegistryProvider({
            timeoutMs: config.ENRICHMENT_TIMEOUT_MS,
            maxRetries: config.ENRICHMENT_MAX_RETRIES,
            maxRpm: config.CNPJ_PROVIDER_MAX_RPM,
          }),
        })
      : new DisabledBusinessEnrichmentProvider('ENRICHMENT_PROVIDER_DISABLED')
    : new HttpBusinessEnrichmentProvider({
        endpoint: config.ENRICHMENT_API_URL!,
        timeoutMs: config.ENRICHMENT_TIMEOUT_MS,
        maxRetries: config.ENRICHMENT_MAX_RETRIES,
        minIntervalMs: config.ENRICHMENT_MIN_INTERVAL_MS,
      })
  : undefined;
const processCollection = createCollectionProcessor(db, {
  enabled: config.COLLECTION_EGRESS_ENABLED && !config.PILOT_KILL_SWITCH_ENABLED,
  endpoint: config.OVERPASS_API_URL,
  timeoutMs: config.OVERPASS_TIMEOUT_MS,
  maxRetries: config.OVERPASS_MAX_RETRIES,
}, operationalLogger, undefined, (database, client) => processNextJob(
  database,
  client,
  enrichmentProvider,
  config.MAX_ENRICHMENT_PER_JOB,
  config.MAX_CANDIDATES_PER_JOB,
));
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
  if (config.WORKER_MODE === 'oneshot') {
    await runOneShot(processCollection, config.MAX_JOBS_PER_RUN, () => gracefulStop.running);
    await shutdown();
    break;
  }
  const collected = await processCollection();
  const report = gracefulStop.running && !config.PILOT_KILL_SWITCH_ENABLED && !shadowGuard.block()
    ? await processLeadBatch({ db, batchSize: config.LEAD_BATCH_SIZE,
      timeBudgetMs: config.PROCESSING_TIME_BUDGET_MS, dailyLimit: config.DAILY_LEAD_LIMIT,
      dryRun: true, executionSource: 'oracle-vps', executorId: workerId,
      processorRole: config.PROCESSOR_ROLE, leadershipLeaseMs: config.PROCESSOR_LEASE_MS,
      processOne: createDryRunItemProcessor({ db, workerId, leaseMs: config.OUTBOX_LEASE_MS,
        dailyLimit: config.DAILY_LEAD_LIMIT, executionSource: 'oracle-vps', policy: executionPolicy }),
    }) : { processed: 0 };
  const consumedOutbox = report.processed > 0;
  if (!collected && !consumedOutbox && gracefulStop.running) {
    await gracefulStop.wait(config.WORKER_POLL_INTERVAL_MS);
  }
}
await shutdown();
