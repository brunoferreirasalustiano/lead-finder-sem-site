import { parseApiConfig } from '@lead-finder/shared';

const restoredExpiredDate = (rawValue: string | undefined, now: number) => {
  if (!rawValue) return undefined;
  const parsed = new Date(rawValue);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() <= now ? parsed : undefined;
};

/**
 * Dedicated HML discovery/Daily-6 bearer credentials are long-lived configuration
 * slots whose tokens are independently rejected by the request authenticator once
 * their expiresAt timestamp passes. An expired slot therefore must not make the
 * public health/readiness process unavailable.
 *
 * We still run the complete shared configuration schema. For syntactically valid,
 * already-expired dedicated timestamps only, a short-lived parse sentinel avoids
 * the startup-only "must be in the future" refinement; the original expired Date
 * is restored immediately in the returned configuration. Missing/malformed fields,
 * wrong environments, permission/profile constraints and every other validation
 * continue to fail closed.
 */
export const parseApiStartupConfig = (environment: NodeJS.ProcessEnv) => {
  const now = Date.now();
  const expiredDiscovery = restoredExpiredDate(environment.HML_DISCOVERY_AUTH_EXPIRES_AT, now);
  const expiredDaily6 = restoredExpiredDate(environment.HML_DAILY6_AUTH_EXPIRES_AT, now);

  if (!expiredDiscovery && !expiredDaily6) return parseApiConfig(environment);

  const parseEnvironment: NodeJS.ProcessEnv = { ...environment };
  const parseSentinel = new Date(now + 60_000).toISOString();
  if (expiredDiscovery) parseEnvironment.HML_DISCOVERY_AUTH_EXPIRES_AT = parseSentinel;
  if (expiredDaily6) parseEnvironment.HML_DAILY6_AUTH_EXPIRES_AT = parseSentinel;

  const parsed = parseApiConfig(parseEnvironment);
  return {
    ...parsed,
    ...(expiredDiscovery ? { HML_DISCOVERY_AUTH_EXPIRES_AT: expiredDiscovery } : {}),
    ...(expiredDaily6 ? { HML_DAILY6_AUTH_EXPIRES_AT: expiredDaily6 } : {}),
  };
};
