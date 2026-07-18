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
] as const;
export type ApiAuthPermission = (typeof apiAuthPermissions)[number];

const apiAuthPermissionSet = new Set<string>(apiAuthPermissions);
const apiAuthPermissionsFromEnvironment = z.string().superRefine((value, context) => {
  const entries = value.split(',');
  if (entries.some((entry) => entry.length === 0)) {
    context.addIssue({ code: 'custom', message: 'API_AUTH_PERMISSIONS must not contain empty entries' });
    return;
  }
  if (entries.some((entry) => entry.trim() !== entry || !/^[a-z]+(?::[a-z][a-z-]*)+$/.test(entry))) {
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

const commonSchema = z.object({
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  DAILY_LEAD_LIMIT: integerFromEnvironment('DAILY_LEAD_LIMIT', 1, 10_000, 50),
  COLLECTION_EGRESS_ENABLED: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.enum(['true', 'false']).default('false'),
  ).transform((value) => value === 'true'),
  OVERPASS_API_URL: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().trim().url().optional(),
  ),
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
  SHADOW_MODE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  PILOT_KILL_SWITCH_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  REAL_PROVIDER_CONFIGURED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  API_AUTH_TOKEN: z.string().min(32).max(512).regex(/^[\x21-\x7e]+$/, 'API_AUTH_TOKEN must contain printable non-space ASCII characters only').refine((value) => value !== 'CHANGE_ME', 'API_AUTH_TOKEN must not use the placeholder value'),
  API_AUTH_PERMISSIONS: apiAuthPermissionsFromEnvironment,
  API_PORT: integerFromEnvironment('API_PORT', 1, 65_535, 3000),
  OPERATIONAL_BACKLOG_DEGRADED_COUNT: integerFromEnvironment('OPERATIONAL_BACKLOG_DEGRADED_COUNT', 1, 1_000_000, 100),
  OPERATIONAL_OLDEST_PENDING_DEGRADED_MS: integerFromEnvironment('OPERATIONAL_OLDEST_PENDING_DEGRADED_MS', 1_000, 604_800_000, 300_000),
}).superRefine(requireCollectionEndpoint);

const workerSchema = commonSchema.extend({
  SHADOW_MODE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  PILOT_KILL_SWITCH_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
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
  const result = apiSchema.safeParse(environment);
  if (!result.success) throw formatConfigurationError(result.error);
  return result.data;
}

export function assertApiKillSwitchReleased(enabled: boolean): void {
  if (enabled) throw new Error('PILOT_KILL_SWITCH_ENGAGED');
}

export function parseWorkerConfig(environment: NodeJS.ProcessEnv) {
  const result = workerSchema.safeParse(environment);
  if (!result.success) throw formatConfigurationError(result.error);
  return result.data;
}
