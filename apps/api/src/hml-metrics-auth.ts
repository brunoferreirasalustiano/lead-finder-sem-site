import { createHash } from 'node:crypto';
import type { TemporaryAuthentication } from './auth.js';

export const hmlMetricsAuthPermissions = Object.freeze([
  'prospecting:metrics:read',
] as const) satisfies TemporaryAuthentication['principalPermissions'];

export type HmlMetricsAuthEnvironment = Readonly<Record<string, string | undefined>>;

export type HmlMetricsAuthConflicts = Readonly<{
  deploymentEnvironment: 'development' | 'homologation' | 'production';
  apiAuthToken: string;
  smokeTokenHash: string | undefined;
  operatorTokenHash: string | undefined;
  smokePrincipalId: string | undefined;
  operatorPrincipalId: string | undefined;
  now?: Date;
}>;

const optionalValue = (value: string | undefined) => value === undefined || value === '' ? undefined : value;
const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const isoWithOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const maximumLifetimeMs = 60 * 60 * 1_000;

export function parseHmlMetricsAuthentication(
  environment: HmlMetricsAuthEnvironment,
  conflicts: HmlMetricsAuthConflicts,
): TemporaryAuthentication | undefined {
  const enabledValue = optionalValue(environment.HML_METRICS_AUTH_ENABLED) ?? 'false';
  if (enabledValue !== 'true' && enabledValue !== 'false') {
    throw new Error('HML_METRICS_AUTH_ENABLED must be true or false');
  }

  const tokenHash = optionalValue(environment.HML_METRICS_AUTH_TOKEN_HASH);
  const expiresAtValue = optionalValue(environment.HML_METRICS_AUTH_EXPIRES_AT);
  const principalId = optionalValue(environment.HML_METRICS_AUTH_PRINCIPAL_ID);
  const fieldsConfigured = tokenHash !== undefined || expiresAtValue !== undefined || principalId !== undefined;

  if (enabledValue === 'false') {
    if (fieldsConfigured) {
      throw new Error('HML metrics authentication fields require HML_METRICS_AUTH_ENABLED=true');
    }
    return undefined;
  }

  if (conflicts.deploymentEnvironment !== 'homologation') {
    throw new Error('HML metrics authentication is permitted only in homologation');
  }
  if (!tokenHash || !/^[0-9a-f]{64}$/i.test(tokenHash)) {
    throw new Error('HML_METRICS_AUTH_TOKEN_HASH must be a SHA-256 hex digest');
  }
  if (!expiresAtValue || !isoWithOffset.test(expiresAtValue)) {
    throw new Error('HML_METRICS_AUTH_EXPIRES_AT must be an ISO-8601 timestamp with an offset');
  }
  const expiresAt = new Date(expiresAtValue);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new Error('HML_METRICS_AUTH_EXPIRES_AT must be a valid timestamp');
  }
  const now = conflicts.now ?? new Date();
  if (expiresAt.getTime() <= now.getTime()) {
    throw new Error('HML_METRICS_AUTH_EXPIRES_AT must be in the future');
  }
  if (expiresAt.getTime() - now.getTime() > maximumLifetimeMs) {
    throw new Error('HML_METRICS_AUTH_EXPIRES_AT must expire within one hour');
  }
  if (!principalId || !/^hml-metrics-[a-z0-9-]{1,80}$/.test(principalId)) {
    throw new Error('HML_METRICS_AUTH_PRINCIPAL_ID must use the hml-metrics- prefix');
  }

  const normalizedTokenHash = tokenHash.toLowerCase();
  const conflictingHashes = [
    sha256Hex(conflicts.apiAuthToken),
    conflicts.smokeTokenHash?.toLowerCase(),
    conflicts.operatorTokenHash?.toLowerCase(),
  ].filter((candidate): candidate is string => candidate !== undefined);
  if (conflictingHashes.includes(normalizedTokenHash)) {
    throw new Error('HML_METRICS_AUTH_TOKEN_HASH must differ from existing authentication tokens');
  }

  const conflictingPrincipalIds = [conflicts.smokePrincipalId, conflicts.operatorPrincipalId]
    .filter((candidate): candidate is string => candidate !== undefined);
  if (conflictingPrincipalIds.includes(principalId)) {
    throw new Error('HML_METRICS_AUTH_PRINCIPAL_ID must differ from existing principals');
  }

  return {
    tokenHash: normalizedTokenHash,
    expiresAt,
    principalId,
    principalPermissions: hmlMetricsAuthPermissions,
    environment: 'homologation',
  };
}
