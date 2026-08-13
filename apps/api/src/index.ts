import { abandonBatchInvocation, beginBatchInvocation, completeBatchInvocation, createDatabase } from '@lead-finder/database';
import { assertApiKillSwitchReleased, hmlDaily6AuthPermissions, hmlDiscoveryAuthPermissions, hmlOperatorAuthPermissions, hmlSmokeAuthPermissions, parseApiConfig } from '@lead-finder/shared';
import { buildApp } from './app.js';
import { registerOperatorTestRoutes } from './operator-test-routes.js';
import { registerOperatorEmailTestRoute } from './operator-email-test-routes.js';
import { registerHmlSuppressionProbeRoute } from './hml-suppression-probe-route.js';
import { parseHmlMetricsAuthentication } from './hml-metrics-auth.js';
import { parseHmlEmailAuthentication } from './hml-email-auth.js';
import { createDryRunItemProcessor, processLeadBatch } from '@lead-finder/batch-processor';
import { createGmailApiManualEmailConsumer, createGmailApiOperatorEmailConsumer } from '@lead-finder/email';
import { createWhatsAppCloudApiClient } from '@lead-finder/whatsapp';
import { hostname } from 'node:os';

type StartupStage =
  | 'API_CONFIG'
  | 'HML_METRICS_AUTH'
  | 'HML_EMAIL_AUTH'
  | 'MANUAL_EMAIL_CONSUMER'
  | 'WHATSAPP_CLOUD_CLIENT'
  | 'OPERATOR_EMAIL_CONSUMER';

const safeConfigurationFields = (error: unknown): string[] => {
  const fields = new Set<string>();
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        if (!issue || typeof issue !== 'object' || !('path' in issue)) continue;
        const path = (issue as { path?: unknown }).path;
        if (Array.isArray(path) && typeof path[0] === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(path[0])) {
          fields.add(path[0]);
        }
      }
    }
  }
  if (error instanceof Error) {
    for (const field of error.message.match(/\b(?:HML|API|DATABASE|DEPLOYMENT|PILOT|MANUAL|OPERATOR|WHATSAPP|COLLECTION|ENRICHMENT)_[A-Z0-9_]+\b/gu) ?? []) {
      fields.add(field);
    }
  }
  return [...fields].sort();
};

const abortStartup = (
  reason: 'INVALID_CONFIGURATION' | 'PILOT_KILL_SWITCH_ENGAGED',
  stage: StartupStage,
  error?: unknown,
): never => {
  const invalidConfigurationFields = reason === 'INVALID_CONFIGURATION' ? safeConfigurationFields(error) : [];
  console.error('api_startup_blocked', {
    reason,
    stage,
    decision: 'SHUTDOWN_REQUESTED',
    ...(invalidConfigurationFields.length > 0 ? { invalidConfigurationFields } : {}),
  });
  process.exit(1);
};

const config = (() => {
  try {
    const parsed = parseApiConfig(process.env);
    assertApiKillSwitchReleased(parsed.PILOT_KILL_SWITCH_ENABLED);
    return parsed;
  } catch (error) {
    return abortStartup(
      error instanceof Error && error.message === 'PILOT_KILL_SWITCH_ENGAGED'
        ? 'PILOT_KILL_SWITCH_ENGAGED'
        : 'INVALID_CONFIGURATION',
      'API_CONFIG',
      error,
    );
  }
})();
const metricsTemporary = (() => {
  try {
    return parseHmlMetricsAuthentication(process.env, {
      deploymentEnvironment: config.DEPLOYMENT_ENVIRONMENT,
      apiAuthToken: config.API_AUTH_TOKEN,
      smokeTokenHash: config.HML_SMOKE_AUTH_TOKEN_HASH,
      operatorTokenHash: config.HML_OPERATOR_AUTH_TOKEN_HASH,
      smokePrincipalId: config.HML_SMOKE_AUTH_PRINCIPAL_ID,
      operatorPrincipalId: config.HML_OPERATOR_AUTH_PRINCIPAL_ID,
    });
  } catch (error) {
    return abortStartup('INVALID_CONFIGURATION', 'HML_METRICS_AUTH', error);
  }
})();
const emailTemporary = (() => {
  try {
    return parseHmlEmailAuthentication(process.env, {
      deploymentEnvironment: config.DEPLOYMENT_ENVIRONMENT,
      apiAuthToken: config.API_AUTH_TOKEN,
      smokeTokenHash: config.HML_SMOKE_AUTH_TOKEN_HASH,
      operatorTokenHash: config.HML_OPERATOR_AUTH_TOKEN_HASH,
      metricsTokenHash: process.env.HML_METRICS_AUTH_TOKEN_HASH,
      smokePrincipalId: config.HML_SMOKE_AUTH_PRINCIPAL_ID,
      operatorPrincipalId: config.HML_OPERATOR_AUTH_PRINCIPAL_ID,
      metricsPrincipalId: process.env.HML_METRICS_AUTH_PRINCIPAL_ID,
    });
  } catch (error) {
    return abortStartup('INVALID_CONFIGURATION', 'HML_EMAIL_AUTH', error);
  }
})();
const discoveryTemporary = config.HML_DISCOVERY_AUTH_ENABLED ? {
  tokenHash: config.HML_DISCOVERY_AUTH_TOKEN_HASH!,
  expiresAt: config.HML_DISCOVERY_AUTH_EXPIRES_AT!,
  principalId: config.HML_DISCOVERY_AUTH_PRINCIPAL_ID!,
  principalPermissions: hmlDiscoveryAuthPermissions,
  environment: 'homologation' as const,
} : undefined;
const daily6Temporary = config.HML_DAILY6_AUTH_ENABLED ? {
  tokenHash: config.HML_DAILY6_AUTH_TOKEN_HASH!,
  expiresAt: config.HML_DAILY6_AUTH_EXPIRES_AT!,
  principalId: config.HML_DAILY6_AUTH_PRINCIPAL_ID!,
  principalPermissions: hmlDaily6AuthPermissions,
  environment: 'homologation' as const,
} : undefined;
const { db, close } = createDatabase(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX, ssl: config.DATABASE_SSL_MODE });
const executorId = `api:${hostname()}:${process.pid}`;
const policy = { dailyLimitEmail: config.CAMPAIGN_DAILY_LIMIT_EMAIL,
  dailyLimitWhatsapp: config.CAMPAIGN_DAILY_LIMIT_WHATSAPP,
  windowStartUtc: config.CAMPAIGN_WINDOW_START_UTC, windowEndUtc: config.CAMPAIGN_WINDOW_END_UTC,
  minSpacingMs: config.CAMPAIGN_MIN_SPACING_MS, maxAttempts: config.OUTBOX_RETRY_MAX_ATTEMPTS,
  retryBaseMs: config.OUTBOX_RETRY_BASE_MS, retryMaxMs: config.OUTBOX_RETRY_MAX_MS };
const manualEmailConsumer = config.MANUAL_EMAIL_SEND_ENABLED
  ? (() => {
      try {
        return createGmailApiManualEmailConsumer({
          sender: config.MANUAL_EMAIL_SENDER!,
          googleClientId: config.MANUAL_EMAIL_GOOGLE_CLIENT_ID!,
          googleClientSecret: config.MANUAL_EMAIL_GOOGLE_CLIENT_SECRET!,
          googleRefreshToken: config.MANUAL_EMAIL_GOOGLE_REFRESH_TOKEN!,
        });
      } catch (error) {
        return abortStartup('INVALID_CONFIGURATION', 'MANUAL_EMAIL_CONSUMER', error);
      }
    })()
  : undefined;
const deliverManualEmail = manualEmailConsumer
  ? (message: { subject: string; body: string; recipient: string }) => manualEmailConsumer.sendManual(message)
  : undefined;
const app = buildApp(db, { dailyLeadLimit: config.DAILY_LEAD_LIMIT,
  collectionEgressEnabled: config.COLLECTION_EGRESS_ENABLED,
  shadowModeEnabled: config.SHADOW_MODE_ENABLED,
  realProviderConfigured: config.REAL_PROVIDER_CONFIGURED,
  manualEmailSendEnabled: config.MANUAL_EMAIL_SEND_ENABLED,
  daily6PilotEnabled: config.DAILY6_PILOT_ENABLED,
  discoveryAuthRequired: config.HML_DISCOVERY_AUTH_ENABLED,
  daily6AuthRequired: config.HML_DAILY6_AUTH_ENABLED,
  ...(config.EXPECTED_OPERATIONAL_SHA ? { expectedOperationalSha: config.EXPECTED_OPERATIONAL_SHA } : {}),
  ...(config.EXPECTED_OPERATIONAL_SHA && config.MANUAL_EMAIL_SENDER && config.MANUAL_EMAIL_FINGERPRINT_KEY
    ? {
        daily6SlotRuntime: {
          enabled: config.DAILY6_PILOT_ENABLED,
          realSendEnabled: config.REAL_SEND_ENABLED,
          manualEmailSendEnabled: config.MANUAL_EMAIL_SEND_ENABLED,
          killSwitchEnabled: config.MANUAL_EMAIL_KILL_SWITCH_ENABLED,
          sender: config.MANUAL_EMAIL_SENDER,
          fingerprintKey: config.MANUAL_EMAIL_FINGERPRINT_KEY,
          operationalSha: config.EXPECTED_OPERATIONAL_SHA,
          deliver: deliverManualEmail ?? (() => Promise.reject(new Error('MANUAL_EMAIL_DISABLED'))),
        },
      }
    : {}),
   manualEmailKillSwitchEnabled: config.MANUAL_EMAIL_KILL_SWITCH_ENABLED,
   hmlSuppressionProbeEnabled: config.HML_SUPPRESSION_PROBE_ENABLED,
  ...(config.MANUAL_EMAIL_SENDER && config.MANUAL_EMAIL_FINGERPRINT_KEY ? { manualEmailSender: config.MANUAL_EMAIL_SENDER, manualEmailFingerprintKey: config.MANUAL_EMAIL_FINGERPRINT_KEY } : {}),
  whatsappCloudRuntime: {
    enabled: config.WHATSAPP_CLOUD_API_ENABLED,
    realSendEnabled: config.REAL_SEND_ENABLED,
    deploymentEnvironment: config.DEPLOYMENT_ENVIRONMENT,
    maxSends: config.WHATSAPP_CLOUD_MAX_SENDS,
    sendScope: config.WHATSAPP_CLOUD_TEST_SCOPE,
    ...(config.WHATSAPP_CLOUD_API_ENABLED && config.REAL_SEND_ENABLED && config.WHATSAPP_CLOUD_PHONE_NUMBER_ID
      ? { phoneNumberId: config.WHATSAPP_CLOUD_PHONE_NUMBER_ID } : {}),
    ...(config.WHATSAPP_CLOUD_API_ENABLED && config.REAL_SEND_ENABLED && config.WHATSAPP_CLOUD_WABA_ID
      ? { wabaId: config.WHATSAPP_CLOUD_WABA_ID } : {}),
    ...(config.WHATSAPP_CLOUD_API_ENABLED && config.REAL_SEND_ENABLED && config.WHATSAPP_CLOUD_ACCESS_TOKEN
      ? { accessToken: config.WHATSAPP_CLOUD_ACCESS_TOKEN } : {}),
    ...(config.WHATSAPP_CLOUD_API_ENABLED && config.REAL_SEND_ENABLED && config.WHATSAPP_CLOUD_TEST_RECIPIENT
      ? { testRecipient: config.WHATSAPP_CLOUD_TEST_RECIPIENT } : {}),
  },
  operationalBacklogDegradedCount: config.OPERATIONAL_BACKLOG_DEGRADED_COUNT,
  operationalOldestPendingDegradedMs: config.OPERATIONAL_OLDEST_PENDING_DEGRADED_MS,
  authentication: {
    token: config.API_AUTH_TOKEN,
    principalPermissions: config.API_AUTH_PERMISSIONS,
    ...(config.HML_SMOKE_AUTH_ENABLED ? {
      temporary: {
        tokenHash: config.HML_SMOKE_AUTH_TOKEN_HASH!,
        expiresAt: config.HML_SMOKE_AUTH_EXPIRES_AT!,
        principalId: config.HML_SMOKE_AUTH_PRINCIPAL_ID!,
        principalPermissions: hmlSmokeAuthPermissions,
        environment: 'homologation',
      },
    } : {}),
    ...(config.HML_OPERATOR_AUTH_ENABLED ? {
      operatorTemporary: {
        tokenHash: config.HML_OPERATOR_AUTH_TOKEN_HASH!,
        expiresAt: config.HML_OPERATOR_AUTH_EXPIRES_AT!,
        principalId: config.HML_OPERATOR_AUTH_PRINCIPAL_ID!,
        principalPermissions: hmlOperatorAuthPermissions,
        environment: 'homologation' as const,
      },
    } : {}),
    ...(metricsTemporary ? { metricsTemporary } : {}),
    ...(emailTemporary ? { emailTemporary } : {}),
    ...(discoveryTemporary ? { discoveryTemporary } : {}),
    ...(daily6Temporary ? { daily6Temporary } : {}),
  },
  prospectingMetricsEnabled: config.PROSPECTING_METRICS_ENABLED,
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
  ...(deliverManualEmail ? { deliverManualEmail } : {}),
  ...(config.WHATSAPP_CLOUD_API_ENABLED && config.REAL_SEND_ENABLED ? (() => {
    try {
      const consumer = createWhatsAppCloudApiClient({
        phoneNumberId: config.WHATSAPP_CLOUD_PHONE_NUMBER_ID!,
        accessToken: config.WHATSAPP_CLOUD_ACCESS_TOKEN!,
        apiVersion: config.WHATSAPP_CLOUD_API_VERSION,
      });
      return { deliverWhatsAppCloud: (message: { phoneNumberId: string; recipient: string; body: string }) => consumer.sendText({ recipient: message.recipient, body: message.body }) };
    } catch (error) {
      return abortStartup('INVALID_CONFIGURATION', 'WHATSAPP_CLOUD_CLIENT', error);
    }
  })() : {}),
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
      } catch (error) {
        return abortStartup('INVALID_CONFIGURATION', 'OPERATOR_EMAIL_CONSUMER', error);
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
if (config.HML_SUPPRESSION_PROBE_ENABLED) {
  registerHmlSuppressionProbeRoute(app, db, {
    enabled: config.HML_SUPPRESSION_PROBE_ENABLED,
    deploymentEnvironment: config.DEPLOYMENT_ENVIRONMENT,
  });
}
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
