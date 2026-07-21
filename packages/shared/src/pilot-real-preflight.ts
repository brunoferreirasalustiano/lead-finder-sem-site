export const pilotRequiredPermissions = [
  'pilot:read',
  'pilot:write',
  'pilot:review',
  'pilot:record-contact',
  'pilot:record-result',
] as const;

export const pilotGateNames = [
  'GATE_HOMOLOGATION_ENV',
  'GATE_SHADOW_MODE',
  'GATE_EXTERNAL_SURFACE_DISABLED',
  'GATE_MINIMUM_PERMISSIONS',
  'GATE_BACKUP_RESTORE',
  'GATE_RESTORE_SUPPRESSION',
  'GATE_ROLLBACK',
  'GATE_KILL_SWITCH',
  'GATE_LOG_PRIVACY',
  'GATE_SYNTHETIC_BATCH_20',
  'GATE_MANUAL_MESSAGE_APPROVED',
] as const;

export type PilotGateName = (typeof pilotGateNames)[number];
export type PilotGateStatus = 'PASS' | 'FAIL' | 'NOT RUN' | 'BLOCKED';
export type PilotGateResults = Record<PilotGateName, PilotGateStatus>;

export type PilotControlCheck = Readonly<{
  status: Exclude<PilotGateStatus, 'BLOCKED'>;
  reasons: readonly string[];
  effectivePermissions?: readonly string[];
}>;

const requiredExternalDisabled = [
  'REAL_PROVIDER_CONFIGURED',
  'COLLECTION_EGRESS_ENABLED',
  'ENABLE_N8N',
  'PILOT_EXTERNAL_PROCESSING_ENABLED',
  'AUTHENTICATED_COLLECTION_ENABLED',
  'AUTOMATED_SENDING_ENABLED',
  'WEBHOOKS_ENABLED',
  'WHATSAPP_AUTOMATION_ENABLED',
  'EMAIL_SENDING_ENABLED',
  'SMS_SENDING_ENABLED',
  'CAMPAIGN_EXTERNAL_CALLS_ENABLED',
] as const;

const safeDatabaseName = 'leadfinder_homologation';
const safeRestoreDatabaseName = 'leadfinder_homologation_restore';

const missing = (name: string) => `MISSING_${name}`;
const placeholder = (value: string) => /(?:change_me|replace(?:_|-)?with|placeholder|example)/iu.test(value);

export function validatePilotPermissions(value: string | undefined): PilotControlCheck {
  if (!value) return { status: 'NOT RUN', reasons: [missing('API_AUTH_PERMISSIONS')] };
  const entries = value.split(',');
  const reasons: string[] = [];
  if (entries.some((entry) => entry.length === 0)) reasons.push('PERMISSION_EMPTY');
  if (entries.some((entry) => entry.trim() !== entry || !/^pilot:[a-z][a-z-]*$/.test(entry))) reasons.push('PERMISSION_MALFORMED');
  if (new Set(entries).size !== entries.length) reasons.push('PERMISSION_DUPLICATED');
  const expected = new Set<string>(pilotRequiredPermissions);
  if (entries.some((entry) => !expected.has(entry))) reasons.push('PERMISSION_EXTRA_OR_FORBIDDEN');
  if (pilotRequiredPermissions.some((entry) => !entries.includes(entry))) reasons.push('PERMISSION_REQUIRED_MISSING');
  return reasons.length > 0
    ? { status: 'FAIL', reasons }
    : { status: 'PASS', reasons: [], effectivePermissions: [...pilotRequiredPermissions] };
}

export function validateExternalSurface(environment: Record<string, string | undefined>): PilotControlCheck {
  const missingFlags = requiredExternalDisabled.filter((name) => environment[name] === undefined);
  if (missingFlags.length > 0) return { status: 'NOT RUN', reasons: missingFlags.map(missing) };
  const enabledFlags = requiredExternalDisabled.filter((name) => environment[name] !== 'false');
  return enabledFlags.length > 0
    ? { status: 'FAIL', reasons: enabledFlags.map((name) => `EXTERNAL_SURFACE_ENABLED_${name}`) }
    : { status: 'PASS', reasons: [] };
}

export function validatePilotHomologationEnvironment(environment: Record<string, string | undefined>): PilotControlCheck {
  const required = [
    'PILOT_HOMOLOGATION', 'NODE_ENV', 'SHADOW_MODE_ENABLED', 'POSTGRES_DB', 'PILOT_DATABASE_GUARD',
    'PILOT_RESTORE_DB', 'DATABASE_URL', 'API_AUTH_TOKEN', 'API_AUTH_PERMISSIONS',
  ] as const;
  const absent = required.filter((name) => environment[name] === undefined);
  if (absent.length > 0) return { status: 'NOT RUN', reasons: absent.map(missing) };

  const reasons: string[] = [];
  if (environment.PILOT_HOMOLOGATION !== 'true') reasons.push('PILOT_HOMOLOGATION_REQUIRED');
  if (environment.NODE_ENV !== 'homologation') reasons.push('NODE_ENV_MUST_BE_HOMOLOGATION');
  if (environment.SHADOW_MODE_ENABLED !== 'true') reasons.push('SHADOW_MODE_MUST_BE_ENABLED');
  if (environment.POSTGRES_DB !== safeDatabaseName) reasons.push('HOMOLOGATION_DATABASE_NAME_REQUIRED');
  if (environment.PILOT_DATABASE_GUARD !== safeDatabaseName) reasons.push('HOMOLOGATION_DATABASE_GUARD_REQUIRED');
  if (environment.PILOT_RESTORE_DB !== safeRestoreDatabaseName) reasons.push('HOMOLOGATION_RESTORE_DATABASE_REQUIRED');
  if (environment.PILOT_RESTORE_DB === environment.POSTGRES_DB) reasons.push('RESTORE_DATABASE_MUST_BE_SEPARATE');
  if (!environment.API_AUTH_TOKEN || placeholder(environment.API_AUTH_TOKEN) || environment.API_AUTH_TOKEN.length < 32)
    reasons.push('API_AUTH_TOKEN_INVALID_OR_PLACEHOLDER');
  try {
    const url = new URL(environment.DATABASE_URL!);
    if (url.protocol !== 'postgresql:') reasons.push('DATABASE_URL_PROTOCOL_INVALID');
    if (decodeURIComponent(url.pathname.replace(/^\//, '')) !== safeDatabaseName) reasons.push('DATABASE_URL_DATABASE_MISMATCH');
    if (/(?:^|[-_.])(prod|production)(?:$|[-_.])/i.test(url.hostname)) reasons.push('DATABASE_URL_PRODUCTION_HOST_REJECTED');
    if (placeholder(decodeURIComponent(url.username)) || placeholder(decodeURIComponent(url.password))) reasons.push('DATABASE_URL_PLACEHOLDER_REJECTED');
  } catch {
    reasons.push('DATABASE_URL_INVALID');
  }
  return reasons.length > 0 ? { status: 'FAIL', reasons } : { status: 'PASS', reasons: [] };
}

export function validateShadowModeIsolation(input: {
  development: Record<string, string | undefined>;
  production: Record<string, string | undefined>;
  homologation: Record<string, string | undefined>;
}): PilotControlCheck {
  const reasons: string[] = [];
  if (input.development.SHADOW_MODE_ENABLED !== 'false') reasons.push('DEVELOPMENT_SHADOW_DEFAULT_NOT_FALSE');
  if (input.production.SHADOW_MODE_ENABLED !== 'false') reasons.push('PRODUCTION_SHADOW_DEFAULT_NOT_FALSE');
  if (input.homologation.SHADOW_MODE_ENABLED !== 'true') reasons.push('HOMOLOGATION_SHADOW_NOT_TRUE');
  if (input.homologation.PILOT_HOMOLOGATION !== 'true') reasons.push('HOMOLOGATION_CONTROL_MARKER_MISSING');
  return reasons.length > 0 ? { status: 'FAIL', reasons } : { status: 'PASS', reasons: [] };
}

export function initialPilotGateResults(): PilotGateResults {
  return Object.fromEntries(pilotGateNames.map((name) => [name, 'NOT RUN'])) as PilotGateResults;
}

export function pilotReadinessDecision(gates: PilotGateResults): 'PILOT_REAL_READY' | 'PILOT_REAL_NOT_READY' {
  return Object.values(gates).every((value) => value === 'PASS') ? 'PILOT_REAL_READY' : 'PILOT_REAL_NOT_READY';
}
