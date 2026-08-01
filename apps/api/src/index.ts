import { abandonBatchInvocation, beginBatchInvocation, completeBatchInvocation, createDatabase } from '@lead-finder/database';
import { assertApiKillSwitchReleased, parseApiConfig } from '@lead-finder/shared';
import { buildApp } from './app.js';
import { registerOperatorTestRoutes } from './operator-test-routes.js';
import { registerOperatorEmailTestRoute } from './operator-email-test-routes.js';
import { createDryRunItemProcessor, processLeadBatch } from '@lead-finder/batch-processor';
import { createGmailApiOperatorEmailConsumer } from '@lead-finder/email';
import { hostname } from 'node:os';

const abortStartup = (reason: 'INVALID_CONFIGURATION' | 'PILOT_KILL_SWITCH_ENGAGED'): never => {
  console.error('api_startup_blocked', { reason, decision: 'SHUTDOWN_REQUESTED' });
  process.exit(1);
};

const config = (() => {
  try {
    const parsed = parseApiConfig(process.env);
    assertApiKillSwitchReleased(parsed.PILOT_KILL_SWITCH_ENABLED);
    return parsed;
  } catch (error) {
    return abortStartup(error instanceof Error && error.message === 'PILOT_KILL_SWITCH_ENGAGED'
      ? 'PILOT_KILL_SWITCH_ENGAGED'
      : 'INVALID_CONFIGURATION');
  }
})();
const { db, close } = createDatabase(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX, ssl: config.DATABASE_SSL_MODE });
const executorId = `api:${hostname()}:${process.pid}`;
const policy = { dailyLimitEmail: config.CAMPAIGN_DAILY_LIMIT_EMAIL,
  dailyLimitWhatsapp: config.CAMPAIGN_DAILY_LIMIT_WHATSAPP,
  windowStartUtc: config.CAMPAIGN_WINDOW_START_UTC, windowEndUtc: config.CAMPAIGN_WINDOW_END_UTC,
  minSpacingMs: config.CAMPAIGN_MIN_SPACING_MS, maxAttempts: config.OUTBOX_RETRY_MAX_ATTEMPTS,
  retryBaseMs: config.OUTBOX_RETRY_BASE_MS, retryMaxMs: config.OUTBOX_RETRY_MAX_MS };
const app = buildApp(db, { dailyLeadLimit: config.DAILY_LEAD_LIMIT,
  collectionEgressEnabled: config.COLLECTION_EGRESS_ENABLED,
  shadowModeEnabled: config.SHADOW_MODE_ENABLED,
  realProviderConfigured: config.REAL_PROVIDER_CONFIGURED,
  operationalBacklogDegradedCount: config.OPERATIONAL_BACKLOG_DEGRADED_COUNT,
  operationalOldestPendingDegradedMs: config.OPERATIONAL_OLDEST_PENDING_DEGRADED_MS,
  authentication: { token: config.API_AUTH_TOKEN, principalPermissions: config.API_AUTH_PERMISSIONS },
  ...(config.INTERNAL_CRON_SECRET ? { internalCronSecret: config.INTERNAL_CRON_SECRET } : {}),
  cronAuthAudience: config.CRON_AUTH_AUDIENCE,
  ...(config.API_BATCH_PROCESSING_ENABLED ? {
    beginBatchInvocation: (key: string) => beginBatchInvocation(db, key, 'supabase-render'),
    completeBatchInvocation: (key: string) => completeBatchInvocation(db, key),
    abandonBatchInvocation: (key: string) => abandonBatchInvocation(db, key),
    processLeadBatch: () => processLeadBatch({ db, batchSize: config.LEAD_BATCH_SIZE,
      timeBudgetMs: config.PROCESSING_TIME_BUDGET_MS, dailyLimit: config.DAILY_LEAD_LIMIT,
      dryRun: true, executionSource: 'supabase-render', executorId,
      processorRole: config.PROCESSOR_ROLE, leadershipLeaseMs: config.PROCESSOR_LEASE_MS,
      processOne: createDryRunItemProcessor({ db, workerId: executorId, leaseMs: config.OUTBOX_LEASE_MS,
        dailyLimit: config.DAILY_LEAD_LIMIT, executionSource: 'supabase-render', policy }),
    }),
  } : {}),
  corsAllowedOrigins: config.CORS_ALLOWED_ORIGINS,
});
registerOperatorTestRoutes(app, db, {
  enabled: config.OPERATOR_TEST_ENABLED,
  killSwitchEnabled: config.OPERATOR_TEST_KILL_SWITCH_ENABLED,
  authorizedPhoneE164: config.OPERATOR_TEST_WHATSAPP_E164,
  fingerprintKey: config.OPERATOR_TEST_FINGERPRINT_KEY,
  recipientBindingKey: config.OPERATOR_TEST_RECIPIENT_BINDING_KEY,
});
const operatorEmailConsumer = config.OPERATOR_EMAIL_TEST_ENABLED
  ? (() => {
      try {
        return createGmailApiOperatorEmailConsumer({
          sender: config.OPERATOR_EMAIL_TEST_SENDER!,
          recipient: config.OPERATOR_EMAIL_TEST_RECIPIENT!,
          googleClientId: config.OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID!,
          googleClientSecret: config.OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET!,
          googleRefreshToken: config.OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN!,
        });
      } catch {
        return abortStartup('INVALID_CONFIGURATION');
      }
    })()
  : undefined;
registerOperatorEmailTestRoute(
  app,
  db,
  {
    enabled: config.OPERATOR_EMAIL_TEST_ENABLED,
    killSwitchEnabled: config.OPERATOR_EMAIL_TEST_KILL_SWITCH_ENABLED,
    authorizedRecipient: config.OPERATOR_EMAIL_TEST_RECIPIENT,
    authorizedSender: config.OPERATOR_EMAIL_TEST_SENDER,
    fingerprintKey: config.OPERATOR_EMAIL_TEST_FINGERPRINT_KEY,
  },
  operatorEmailConsumer
    ? (message) => operatorEmailConsumer.sendInternalTest(message)
    : () => Promise.reject(new Error('OPERATOR_EMAIL_TEST_DISABLED')),
);
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
