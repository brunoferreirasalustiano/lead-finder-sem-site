import { createDatabase } from '@lead-finder/database';
import { parseApiConfig } from '@lead-finder/shared';
import { buildApp } from './app.js';
const config = parseApiConfig(process.env);
const { db, close } = createDatabase(config.DATABASE_URL);
const app = buildApp(db, { dailyLeadLimit: config.DAILY_LEAD_LIMIT,
  collectionEgressEnabled: config.COLLECTION_EGRESS_ENABLED,
  shadowModeEnabled: config.SHADOW_MODE_ENABLED,
  realProviderConfigured: config.REAL_PROVIDER_CONFIGURED,
  operationalBacklogDegradedCount: config.OPERATIONAL_BACKLOG_DEGRADED_COUNT,
  operationalOldestPendingDegradedMs: config.OPERATIONAL_OLDEST_PENDING_DEGRADED_MS,
  authentication: { token: config.API_AUTH_TOKEN },
});
let shutdownPromise: Promise<void> | undefined;
const shutdown = (exitCode = 0) => {
  process.exitCode = exitCode;
  shutdownPromise ??= (async () => {
    await app.close();
    await close();
  })();
  return shutdownPromise;
};
const fatal = (kind: string, error: unknown) => {
  void error;
  app.log.fatal({ event: 'api_fatal', kind, decision: 'SHUTDOWN_REQUESTED' }, 'api_fatal');
  void shutdown(1);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('unhandledRejection', (error) => fatal('Unhandled rejection', error));
process.on('uncaughtException', (error) => fatal('Uncaught exception', error));
try {
  await app.listen({ host: '0.0.0.0', port: config.API_PORT });
} catch (error) {
  fatal('API startup failed', error);
  await shutdownPromise;
}
