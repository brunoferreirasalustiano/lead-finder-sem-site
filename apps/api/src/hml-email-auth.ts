import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TemporaryAuthentication } from './auth.js';

export const hmlEmailAuthPermissions = Object.freeze([
  'manual-messaging:prepare',
  'manual-messaging:open',
  'manual-messaging:send',
  'manual-messaging:cancel',
] as const) satisfies TemporaryAuthentication['principalPermissions'];

export type HmlEmailAuthEnvironment = Readonly<Record<string, string | undefined>>;

export type HmlEmailAuthConflicts = Readonly<{
  deploymentEnvironment: 'development' | 'homologation' | 'production';
  apiAuthToken: string;
  smokeTokenHash: string | undefined;
  operatorTokenHash: string | undefined;
  metricsTokenHash: string | undefined;
  smokePrincipalId: string | undefined;
  operatorPrincipalId: string | undefined;
  metricsPrincipalId: string | undefined;
  now?: Date;
}>;

const optionalValue = (value: string | undefined) => value === undefined || value === '' ? undefined : value;
const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const expiresAtSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const maximumLifetimeMs = 60 * 60 * 1_000;

export function parseHmlEmailAuthentication(
  environment: HmlEmailAuthEnvironment,
  conflicts: HmlEmailAuthConflicts,
): TemporaryAuthentication | undefined {
  const enabledValue = optionalValue(environment.HML_EMAIL_AUTH_ENABLED) ?? 'false';
  if (enabledValue !== 'true' && enabledValue !== 'false') {
    throw new Error('HML_EMAIL_AUTH_ENABLED must be true or false');
  }

  const tokenHash = optionalValue(environment.HML_EMAIL_AUTH_TOKEN_HASH);
  const expiresAtValue = optionalValue(environment.HML_EMAIL_AUTH_EXPIRES_AT);
  const principalId = optionalValue(environment.HML_EMAIL_AUTH_PRINCIPAL_ID);
  const fieldsConfigured = tokenHash !== undefined || expiresAtValue !== undefined || principalId !== undefined;

  if (enabledValue === 'false') {
    if (fieldsConfigured) {
      throw new Error('HML email authentication fields require HML_EMAIL_AUTH_ENABLED=true');
    }
    return undefined;
  }

  if (conflicts.deploymentEnvironment !== 'homologation') {
    throw new Error('HML email authentication is permitted only in homologation');
  }
  if (!tokenHash || !/^[0-9a-f]{64}$/i.test(tokenHash)) {
    throw new Error('HML_EMAIL_AUTH_TOKEN_HASH must be a SHA-256 hex digest');
  }
  if (!expiresAtValue) {
    throw new Error('HML_EMAIL_AUTH_EXPIRES_AT must be an ISO-8601 timestamp with an offset');
  }
  const parsedExpiry = expiresAtSchema.safeParse(expiresAtValue);
  if (!parsedExpiry.success) {
    throw new Error('HML_EMAIL_AUTH_EXPIRES_AT must be a valid ISO-8601 timestamp with an offset');
  }
  const expiresAt = parsedExpiry.data;
  const now = conflicts.now ?? new Date();
  if (expiresAt.getTime() <= now.getTime()) {
    throw new Error('HML_EMAIL_AUTH_EXPIRES_AT must be in the future');
  }
  if (expiresAt.getTime() - now.getTime() > maximumLifetimeMs) {
    throw new Error('HML_EMAIL_AUTH_EXPIRES_AT must expire within one hour');
  }
  if (!principalId || !/^hml-email-[a-z0-9-]{1,80}$/.test(principalId)) {
    throw new Error('HML_EMAIL_AUTH_PRINCIPAL_ID must use the hml-email- prefix');
  }

  const normalizedTokenHash = tokenHash.toLowerCase();
  const conflictingHashes = [
    sha256Hex(conflicts.apiAuthToken),
    conflicts.smokeTokenHash?.toLowerCase(),
    conflicts.operatorTokenHash?.toLowerCase(),
    conflicts.metricsTokenHash?.toLowerCase(),
  ].filter((candidate): candidate is string => candidate !== undefined);
  if (conflictingHashes.includes(normalizedTokenHash)) {
    throw new Error('HML_EMAIL_AUTH_TOKEN_HASH must differ from existing authentication tokens');
  }

  const conflictingPrincipalIds = [
    conflicts.smokePrincipalId,
    conflicts.operatorPrincipalId,
    conflicts.metricsPrincipalId,
  ].filter((candidate): candidate is string => candidate !== undefined);
  if (conflictingPrincipalIds.includes(principalId)) {
    throw new Error('HML_EMAIL_AUTH_PRINCIPAL_ID must differ from existing principals');
  }

  return {
    tokenHash: normalizedTokenHash,
    expiresAt,
    principalId,
    principalPermissions: hmlEmailAuthPermissions,
    environment: 'homologation',
  };
}
