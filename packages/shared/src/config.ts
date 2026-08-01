import { z } from 'zod';

export const apiAuthPermissions = [
  'leads:read',
  'contacts:read',
  'leads:export',
  'crm:read',
  'crm:write',
  'crm:reactivate-do-not-contact',
  'campaigns:read',
  'campaigns:write',
  'operations:read',
  'collection:execute',
  'pilot:read',
  'pilot:write',
  'pilot:review',
  'pilot:record-contact',
  'pilot:record-result',
  'pilot:complete',
  'manual-messaging:prepare',
  'manual-messaging:open',
  'manual-messaging:confirm',
  'manual-messaging:send',
  'manual-messaging:opt-out',
  'operator-test:prepare',
  'operator-test:open',
  'operator-test:confirm',
  'operator-test:response',
  'operator-email-test:send',
] as const;
export type ApiAuthPermission = (typeof apiAuthPermissions)[number];

const apiAuthPermissionSet = new Set<string>(apiAuthPermissions);
const apiAuthPermissionsFromEnvironment = z.string().superRefine((value, context) => {
  const entries = value.split(',');
  if (entries.some((entry) => entry.length === 0)) {
    context.addIssue({ code: 'custom', message: 'API_AUTH_PERMISSIONS must not contain empty entries' });
    return;
  }
  if (entries.some((entry) => entry.trim() !== entry || !/^[a-z][a-z-]*(?::[a-z][a-z-]*)+$/.test(entry))) {
    context.addIssue({ code: 'custom', message: 'API_AUTH_PERMISSIONS contains a malformed permission' });
  }
  const duplicates = entries.filter((entry, index) => entries.indexOf(entry) !== index);
  if (duplicates.length > 0) {
    context.addIssue({ code: 'custom', message: 'API_AUTH_PERMISSIONS must not contain duplicate permissions' });
  }
  for (const entry of entries) if (!apiAuthPermissionSet.has(entry)) {
    context.addIssue({ code: 'custom', message: `API_AUTH_PERMISSIONS contains unknown permission: ${entry}` });
  }
}).transform((value) => value.split(',') as ApiAuthPermission[]);

const integerFromEnvironment = (name: string, minimum: number, maximum: number, fallback: number) =>
  z
    .string()
    .default(String(fallback))
    .refine((value) => /^\d+$/.test(value), `${name} must be a positive base-10 integer`)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));

const optionalEnvironmentString = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(
  (value) => value === '' ? undefined : value,
  schema.optional(),
);

const commonSchema = z.object({
  DEPLOYMENT_PROFILE: z.enum(['oracle-vps', 'supabase-render']).default('oracle-vps'),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  DAILY_LEAD_LIMIT: integerFromEnvironment('DAILY_LEAD_LIMIT', 1, 60, 60),
  DATABASE_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DATABASE_POOL_MAX: integerFromEnvironment('DATABASE_POOL_MAX', 1, 20, 10),
  CORS_ALLOWED_ORIGINS: z.string().trim().default('http://127.0.0.1:3000').transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)).pipe(z.array(z.string().url()).min(1).max(20)),
  COLLECTION_EGRESS_ENABLED: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.enum(['true', 'false']).default('false'),
  ).transform((value) => value === 'true'),
  OVERPASS_API_URL: optionalEnvironmentString(z.string().trim().url()),
});

const requireCollectionEndpoint = (
  configuration: { COLLECTION_EGRESS_ENABLED: boolean; OVERPASS_API_URL?: string | undefined },
  context: z.RefinementCtx,
) => {
  if (configuration.COLLECTION_EGRESS_ENABLED && !configuration.OVERPASS_API_URL) {
    context.addIssue({
      code: 'custom',
      path: ['OVERPASS_API_URL'],
      message: 'OVERPASS_API_URL is required when COLLECTION_EGRESS_ENABLED=true',
    });
  }
};

const apiSchema = commonSchema.extend({
  DRY_RUN: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  REAL_SEND_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  REAL_PROVIDERS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  INTERNAL_CRON_SECRET: z.string().min(32).max(512).optional(),
  API_BATCH_PROCESSING_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CRON_AUTH_AUDIENCE: z.string().trim().min(1).max(200).default('lead-finder-batch'),
  LEAD_BATCH_SIZE: integerFromEnvironment('LEAD_BATCH_SIZE', 1, 10, 5),
  PROCESSING_TIME_BUDGET_MS: integerFromEnvironment('PROCESSING_TIME_BUDGET_MS', 1_000, 50_000, 45_000),
  PROCESSOR_ROLE: z.enum(['primary', 'standby']).default('standby'),
  PROCESSOR_LEASE_MS: integerFromEnvironment('PROCESSOR_LEASE_MS', 5_000, 300_000, 60_000),
  OUTBOX_LEASE_MS: integerFromEnvironment('OUTBOX_LEASE_MS', 1_000, 3_600_000, 30_000),
  OUTBOX_RETRY_MAX_ATTEMPTS: integerFromEnvironment('OUTBOX_RETRY_MAX_ATTEMPTS', 1, 100, 5),
  OUTBOX_RETRY_BASE_MS: integerFromEnvironment('OUTBOX_RETRY_BASE_MS', 1, 604_800_000, 1_000),
  OUTBOX_RETRY_MAX_MS: integerFromEnvironment('OUTBOX_RETRY_MAX_MS', 1, 604_800_000, 60_000),
  CAMPAIGN_DAILY_LIMIT_EMAIL: integerFromEnvironment('CAMPAIGN_DAILY_LIMIT_EMAIL', 1, 60, 60),
  CAMPAIGN_DAILY_LIMIT_WHATSAPP: integerFromEnvironment('CAMPAIGN_DAILY_LIMIT_WHATSAPP', 1, 60, 60),
  CAMPAIGN_WINDOW_START_UTC: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('08:00'),
  CAMPAIGN_WINDOW_END_UTC: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('18:00'),
  CAMPAIGN_MIN_SPACING_MS: integerFromEnvironment('CAMPAIGN_MIN_SPACING_MS', 0, 86_400_000, 0),
  SHADOW_MODE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  PILOT_KILL_SWITCH_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  REAL_PROVIDER_CONFIGURED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  OPERATOR_TEST_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  OPERATOR_TEST_KILL_SWITCH_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  OPERATOR_TEST_WHATSAPP_E164: optionalEnvironmentString(
    z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'OPERATOR_TEST_WHATSAPP_E164 must use E.164 format'),
  ),
  OPERATOR_TEST_FINGERPRINT_KEY: optionalEnvironmentString(
    z.string().min(32).max(512).regex(/^[\x21-\x7e]+$/, 'OPERATOR_TEST_FINGERPRINT_KEY must contain printable non-space ASCII characters only'),
  ),
  OPERATOR_TEST_RECIPIENT_BINDING_KEY: optionalEnvironmentString(
    z.string().min(32).max(512).regex(/^[\x21-\x7e]+$/, 'OPERATOR_TEST_RECIPIENT_BINDING_KEY must contain printable non-space ASCII characters only'),
  ),
  OPERATOR_EMAIL_TEST_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  OPERATOR_EMAIL_TEST_KILL_SWITCH_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  OPERATOR_EMAIL_TEST_RECIPIENT: optionalEnvironmentString(
    z.string().trim().toLowerCase().email().max(320),
  ),
  OPERATOR_EMAIL_TEST_SENDER: optionalEnvironmentString(
    z.string().trim().toLowerCase().email().max(320),
  ),
  OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID: optionalEnvironmentString(
    z.string().trim().min(1).max(512),
  ),
  OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET: optionalEnvironmentString(
    z.string().min(16).max(1024).regex(/^[\x21-\x7e]+$/, 'OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET must contain printable non-space ASCII characters only'),
  ),
  OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN: optionalEnvironmentString(
    z.string().min(16).max(2048).regex(/^[\x21-\x7e]+$/, 'OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN must contain printable non-space ASCII characters only'),
  ),
  OPERATOR_EMAIL_TEST_FINGERPRINT_KEY: optionalEnvironmentString(
    z.string().min(32).max(512).regex(/^[\x21-\x7e]+$/, 'OPERATOR_EMAIL_TEST_FINGERPRINT_KEY must contain printable non-space ASCII characters only'),
  ),
  MANUAL_EMAIL_SEND_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MANUAL_EMAIL_KILL_SWITCH_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  MANUAL_EMAIL_SENDER: optionalEnvironmentString(z.string().trim().toLowerCase().email().max(320)),
  MANUAL_EMAIL_GOOGLE_CLIENT_ID: optionalEnvironmentString(z.string().trim().min(1).max(512)),
  MANUAL_EMAIL_GOOGLE_CLIENT_SECRET: optionalEnvironmentString(z.string().min(16).max(1024).regex(/^[\x21-\x7e]+$/)),
  MANUAL_EMAIL_GOOGLE_REFRESH_TOKEN: optionalEnvironmentString(z.string().min(16).max(2048).regex(/^[\x21-\x7e]+$/)),
  MANUAL_EMAIL_FINGERPRINT_KEY: optionalEnvironmentString(z.string().min(32).max(512).regex(/^[\x21-\x7e]+$/)),
  API_AUTH_TOKEN: z.string().min(32).max(512).regex(/^[\x21-\x7e]+$/, 'API_AUTH_TOKEN must contain printable non-space ASCII characters only').refine((value) => value !== 'CHANGE_ME', 'API_AUTH_TOKEN must not use the placeholder value'),
  API_AUTH_PERMISSIONS: apiAuthPermissionsFromEnvironment,
  API_PORT: integerFromEnvironment('API_PORT', 1, 65_535, 3000),
  OPERATIONAL_BACKLOG_DEGRADED_COUNT: integerFromEnvironment('OPERATIONAL_BACKLOG_DEGRADED_COUNT', 1, 1_000_000, 100),
  OPERATIONAL_OLDEST_PENDING_DEGRADED_MS: integerFromEnvironment('OPERATIONAL_OLDEST_PENDING_DEGRADED_MS', 1_000, 604_800_000, 300_000),
}).superRefine((configuration, context) => {
  requireCollectionEndpoint(configuration, context);
  const operatorTestSecretsConfigured = configuration.OPERATOR_TEST_WHATSAPP_E164 !== undefined
    || configuration.OPERATOR_TEST_FINGERPRINT_KEY !== undefined
    || configuration.OPERATOR_TEST_RECIPIENT_BINDING_KEY !== undefined;
  if (!configuration.OPERATOR_TEST_ENABLED && operatorTestSecretsConfigured) {
    context.addIssue({
      code: 'custom',
      path: ['OPERATOR_TEST_ENABLED'],
      message: 'OPERATOR_TEST_ENABLED must be true when operator test secrets are configured',
    });
  }
  if (configuration.OPERATOR_TEST_ENABLED && !configuration.OPERATOR_TEST_WHATSAPP_E164) {
    context.addIssue({
      code: 'custom',
      path: ['OPERATOR_TEST_WHATSAPP_E164'],
      message: 'OPERATOR_TEST_WHATSAPP_E164 is required when OPERATOR_TEST_ENABLED=true',
    });
  }
  if (configuration.OPERATOR_TEST_ENABLED && !configuration.OPERATOR_TEST_FINGERPRINT_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['OPERATOR_TEST_FINGERPRINT_KEY'],
      message: 'OPERATOR_TEST_FINGERPRINT_KEY is required when OPERATOR_TEST_ENABLED=true',
    });
  }
  if (configuration.OPERATOR_TEST_ENABLED && !configuration.OPERATOR_TEST_RECIPIENT_BINDING_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['OPERATOR_TEST_RECIPIENT_BINDING_KEY'],
      message: 'OPERATOR_TEST_RECIPIENT_BINDING_KEY is required when OPERATOR_TEST_ENABLED=true',
    });
  }
  if (
    configuration.OPERATOR_TEST_RECIPIENT_BINDING_KEY
    && configuration.OPERATOR_TEST_RECIPIENT_BINDING_KEY === configuration.API_AUTH_TOKEN
  ) {
    context.addIssue({
      code: 'custom',
      path: ['OPERATOR_TEST_RECIPIENT_BINDING_KEY'],
      message: 'OPERATOR_TEST_RECIPIENT_BINDING_KEY must differ from API_AUTH_TOKEN',
    });
  }
  const manualEmailSecretsConfigured = configuration.MANUAL_EMAIL_SENDER !== undefined
    || configuration.MANUAL_EMAIL_GOOGLE_CLIENT_ID !== undefined
    || configuration.MANUAL_EMAIL_GOOGLE_CLIENT_SECRET !== undefined
    || configuration.MANUAL_EMAIL_GOOGLE_REFRESH_TOKEN !== undefined
    || configuration.MANUAL_EMAIL_FINGERPRINT_KEY !== undefined;
  if (!configuration.MANUAL_EMAIL_SEND_ENABLED && manualEmailSecretsConfigured)
    context.addIssue({ code: 'custom', path: ['MANUAL_EMAIL_SEND_ENABLED'], message: 'MANUAL_EMAIL_SEND_ENABLED must be true when manual email secrets are configured' });
  if (configuration.MANUAL_EMAIL_SEND_ENABLED) {
    const required = [
      ['MANUAL_EMAIL_SENDER', configuration.MANUAL_EMAIL_SENDER],
      ['MANUAL_EMAIL_GOOGLE_CLIENT_ID', configuration.MANUAL_EMAIL_GOOGLE_CLIENT_ID],
      ['MANUAL_EMAIL_GOOGLE_CLIENT_SECRET', configuration.MANUAL_EMAIL_GOOGLE_CLIENT_SECRET],
      ['MANUAL_EMAIL_GOOGLE_REFRESH_TOKEN', configuration.MANUAL_EMAIL_GOOGLE_REFRESH_TOKEN],
      ['MANUAL_EMAIL_FINGERPRINT_KEY', configuration.MANUAL_EMAIL_FINGERPRINT_KEY],
    ] as const;
    for (const [name, value] of required) if (!value)
      context.addIssue({ code: 'custom', path: [name], message: `${name} is required when MANUAL_EMAIL_SEND_ENABLED=true` });
  }
  if (configuration.MANUAL_EMAIL_FINGERPRINT_KEY === configuration.API_AUTH_TOKEN)
    context.addIssue({ code: 'custom', path: ['MANUAL_EMAIL_FINGERPRINT_KEY'], message: 'MANUAL_EMAIL_FINGERPRINT_KEY must differ from API_AUTH_TOKEN' });
  if (
    configuration.OPERATOR_TEST_RECIPIENT_BINDING_KEY
    && configuration.OPERATOR_TEST_RECIPIENT_BINDING_KEY === configuration.OPERATOR_TEST_FINGERPRINT_KEY
  ) {
    context.addIssue({
      code: 'custom',
      path: ['OPERATOR_TEST_RECIPIENT_BINDING_KEY'],
      message: 'OPERATOR_TEST_RECIPIENT_BINDING_KEY must differ from OPERATOR_TEST_FINGERPRINT_KEY',
    });
  }
  const operatorEmailSecretsConfigured = configuration.OPERATOR_EMAIL_TEST_RECIPIENT !== undefined
    || configuration.OPERATOR_EMAIL_TEST_SENDER !== undefined
    || configuration.OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID !== undefined
    || configuration.OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET !== undefined
    || configuration.OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN !== undefined
    || configuration.OPERATOR_EMAIL_TEST_FINGERPRINT_KEY !== undefined;
  if (!configuration.OPERATOR_EMAIL_TEST_ENABLED && operatorEmailSecretsConfigured) {
    context.addIssue({
      code: 'custom',
      path: ['OPERATOR_EMAIL_TEST_ENABLED'],
      message: 'OPERATOR_EMAIL_TEST_ENABLED must be true when operator email test secrets are configured',
    });
  }
  if (configuration.OPERATOR_EMAIL_TEST_ENABLED) {
    const required = [
      ['OPERATOR_EMAIL_TEST_RECIPIENT', configuration.OPERATOR_EMAIL_TEST_RECIPIENT],
      ['OPERATOR_EMAIL_TEST_SENDER', configuration.OPERATOR_EMAIL_TEST_SENDER],
      ['OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID', configuration.OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID],
      ['OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET', configuration.OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET],
      ['OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN', configuration.OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN],
      ['OPERATOR_EMAIL_TEST_FINGERPRINT_KEY', configuration.OPERATOR_EMAIL_TEST_FINGERPRINT_KEY],
    ] as const;
    for (const [name, value] of required) {
      if (!value) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required when OPERATOR_EMAIL_TEST_ENABLED=true`,
        });
      }
    }
    if (
      configuration.OPERATOR_EMAIL_TEST_RECIPIENT
      && configuration.OPERATOR_EMAIL_TEST_SENDER
      && configuration.OPERATOR_EMAIL_TEST_RECIPIENT !== configuration.OPERATOR_EMAIL_TEST_SENDER
    ) {
      context.addIssue({
        code: 'custom',
        path: ['OPERATOR_EMAIL_TEST_RECIPIENT'],
        message: 'operator email test sender and recipient must be identical',
      });
    }
  }
  if (
    configuration.OPERATOR_EMAIL_TEST_FINGERPRINT_KEY
    && configuration.OPERATOR_EMAIL_TEST_FINGERPRINT_KEY === configuration.API_AUTH_TOKEN
  ) {
    context.addIssue({
      code: 'custom',
      path: ['OPERATOR_EMAIL_TEST_FINGERPRINT_KEY'],
      message: 'OPERATOR_EMAIL_TEST_FINGERPRINT_KEY must differ from API_AUTH_TOKEN',
    });
  }
  const requireDifferentSecrets = (
    leftName: string,
    leftValue: string | undefined,
    rightName: string,
    rightValue: string | undefined,
  ) => {
    if (leftValue !== undefined && leftValue === rightValue) {
      context.addIssue({
        code: 'custom',
        path: [leftName],
        message: `${leftName} must differ from ${rightName}`,
      });
    }
  };
  requireDifferentSecrets('OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET', configuration.OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET, 'API_AUTH_TOKEN', configuration.API_AUTH_TOKEN);
  requireDifferentSecrets('OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN', configuration.OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN, 'API_AUTH_TOKEN', configuration.API_AUTH_TOKEN);
  requireDifferentSecrets('OPERATOR_EMAIL_TEST_FINGERPRINT_KEY', configuration.OPERATOR_EMAIL_TEST_FINGERPRINT_KEY, 'API_AUTH_TOKEN', configuration.API_AUTH_TOKEN);
  requireDifferentSecrets('OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET', configuration.OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET, 'OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN', configuration.OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN);
  requireDifferentSecrets('OPERATOR_EMAIL_TEST_FINGERPRINT_KEY', configuration.OPERATOR_EMAIL_TEST_FINGERPRINT_KEY, 'OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET', configuration.OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET);
  requireDifferentSecrets('OPERATOR_EMAIL_TEST_FINGERPRINT_KEY', configuration.OPERATOR_EMAIL_TEST_FINGERPRINT_KEY, 'OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN', configuration.OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN);
  if (configuration.DEPLOYMENT_PROFILE === 'supabase-render') {
    const unsafe = !configuration.DRY_RUN || configuration.REAL_SEND_ENABLED
      || configuration.REAL_PROVIDERS_ENABLED || configuration.COLLECTION_EGRESS_ENABLED
      || !configuration.SHADOW_MODE_ENABLED;
    if (unsafe) context.addIssue({ code: 'custom', path: ['DEPLOYMENT_PROFILE'], message: 'supabase-render requires dry-run, shadow mode, disabled providers, sends, and collection egress' });
    if (!configuration.INTERNAL_CRON_SECRET) context.addIssue({ code: 'custom', path: ['INTERNAL_CRON_SECRET'], message: 'INTERNAL_CRON_SECRET is required for supabase-render' });
  }
});

const workerSchema = commonSchema.extend({
  DRY_RUN: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  REAL_SEND_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  REAL_PROVIDERS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  LEAD_BATCH_SIZE: integerFromEnvironment('LEAD_BATCH_SIZE', 1, 10, 5),
  PROCESSING_TIME_BUDGET_MS: integerFromEnvironment('PROCESSING_TIME_BUDGET_MS', 1_000, 50_000, 45_000),
  PROCESSOR_ROLE: z.enum(['primary', 'standby']).default('standby'),
  PROCESSOR_LEASE_MS: integerFromEnvironment('PROCESSOR_LEASE_MS', 5_000, 300_000, 60_000),
  SHADOW_MODE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  PILOT_KILL_SWITCH_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  WORKER_ID: z.string().trim().min(1).max(200).optional(),
  OUTBOX_LEASE_MS: integerFromEnvironment('OUTBOX_LEASE_MS', 1_000, 3_600_000, 30_000),
  OVERPASS_TIMEOUT_MS: integerFromEnvironment('OVERPASS_TIMEOUT_MS', 1_000, 120_000, 30_000),
  OVERPASS_MAX_RETRIES: integerFromEnvironment('OVERPASS_MAX_RETRIES', 0, 10, 3),
  WORKER_POLL_INTERVAL_MS: integerFromEnvironment(
    'WORKER_POLL_INTERVAL_MS',
    1_000,
    3_600_000,
    60_000,
  ),
  CAMPAIGN_DAILY_LIMIT_EMAIL: integerFromEnvironment(
    'CAMPAIGN_DAILY_LIMIT_EMAIL', 1, 1_000_000, 50,
  ),
  CAMPAIGN_DAILY_LIMIT_WHATSAPP: integerFromEnvironment(
    'CAMPAIGN_DAILY_LIMIT_WHATSAPP', 1, 1_000_000, 50,
  ),
  CAMPAIGN_WINDOW_START_UTC: z.string().regex(
    /^(?:[01]\d|2[0-3]):[0-5]\d$/,
    'CAMPAIGN_WINDOW_START_UTC must use HH:mm UTC format',
  ).default('08:00'),
  CAMPAIGN_WINDOW_END_UTC: z.string().regex(
    /^(?:[01]\d|2[0-3]):[0-5]\d$/,
    'CAMPAIGN_WINDOW_END_UTC must use HH:mm UTC format',
  ).default('18:00'),
  CAMPAIGN_MIN_SPACING_MS: integerFromEnvironment(
    'CAMPAIGN_MIN_SPACING_MS', 0, 86_400_000, 0,
  ),
  OUTBOX_RETRY_MAX_ATTEMPTS: integerFromEnvironment(
    'OUTBOX_RETRY_MAX_ATTEMPTS', 1, 100, 5,
  ),
  OUTBOX_RETRY_BASE_MS: integerFromEnvironment(
    'OUTBOX_RETRY_BASE_MS', 1, 604_800_000, 1_000,
  ),
  OUTBOX_RETRY_MAX_MS: integerFromEnvironment(
    'OUTBOX_RETRY_MAX_MS', 1, 604_800_000, 60_000,
  ),
}).superRefine((configuration, context) => {
  requireCollectionEndpoint(configuration, context);
  if (configuration.DEPLOYMENT_PROFILE === 'supabase-render') {
    context.addIssue({ code: 'custom', path: ['DEPLOYMENT_PROFILE'], message: 'supabase-render must use the bounded API batch endpoint, not the continuous worker' });
  }
  if (!configuration.DRY_RUN || configuration.REAL_SEND_ENABLED || configuration.REAL_PROVIDERS_ENABLED) {
    context.addIssue({ code: 'custom', path: ['DRY_RUN'], message: 'real providers and sends are not implemented; DRY_RUN must remain true' });
  }
  if (configuration.CAMPAIGN_WINDOW_START_UTC >= configuration.CAMPAIGN_WINDOW_END_UTC) {
    context.addIssue({
      code: 'custom',
      path: ['CAMPAIGN_WINDOW_END_UTC'],
      message: 'CAMPAIGN_WINDOW_END_UTC must be later than CAMPAIGN_WINDOW_START_UTC; overnight windows are not supported',
    });
  }
  if (configuration.OUTBOX_RETRY_BASE_MS > configuration.OUTBOX_RETRY_MAX_MS) {
    context.addIssue({
      code: 'custom',
      path: ['OUTBOX_RETRY_MAX_MS'],
      message: 'OUTBOX_RETRY_MAX_MS must be greater than or equal to OUTBOX_RETRY_BASE_MS',
    });
  }
});

function formatConfigurationError(error: z.ZodError): Error {
  const details = error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  return new Error(`Invalid environment configuration: ${details}`);
}

export function parseApiConfig(environment: NodeJS.ProcessEnv) {
  const result = apiSchema.safeParse({ ...environment, API_PORT: environment.API_PORT ?? environment.PORT });
  if (!result.success) throw formatConfigurationError(result.error);
  return result.data;
}

export function assertApiKillSwitchReleased(enabled: boolean): void {
  if (enabled) throw new Error('PILOT_KILL_SWITCH_ENGAGED');
}

const contactResolverSchema = z.object({
  CONTACT_RESOLVER_DATABASE_URL: z.string().url().startsWith('postgresql://'),
  MANUAL_MESSAGING_ENABLED: z.literal('true').transform(() => true as const),
  CONTACT_RESOLUTION_KILL_SWITCH_ENABLED: z.literal('false').transform(() => false as const),
  CONTACT_RESOLUTION_MODE: z.literal('LOCAL_MANUAL').transform(() => 'LOCAL_MANUAL' as const),
  CONTACT_RESOLUTION_NO_PROVIDER_MODE: z.literal('true').transform(() => true as const),
  REAL_PROVIDERS_ENABLED: z.literal('false').transform(() => false as const),
  REAL_PROVIDER_CONFIGURED: z.literal('false').transform(() => false as const),
  DATABASE_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
});

export function parseContactResolverConfig(environment: NodeJS.ProcessEnv) {
  const result = contactResolverSchema.safeParse(environment);
  if (!result.success) throw formatConfigurationError(result.error);
  return result.data;
}

export function parseWorkerConfig(environment: NodeJS.ProcessEnv) {
  const result = workerSchema.safeParse(environment);
  if (!result.success) throw formatConfigurationError(result.error);
  return result.data;
}
