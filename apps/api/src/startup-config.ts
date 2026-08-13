import { parseApiConfig } from '@lead-finder/shared';

const dedicatedExpiryPaths = new Set([
  'HML_DISCOVERY_AUTH_EXPIRES_AT',
  'HML_DAILY6_AUTH_EXPIRES_AT',
] as const);

type DedicatedExpiryPath = 'HML_DISCOVERY_AUTH_EXPIRES_AT' | 'HML_DAILY6_AUTH_EXPIRES_AT';

const expiredDedicatedPathsFromError = (error: unknown): DedicatedExpiryPath[] | undefined => {
  if (!error || typeof error !== 'object' || !('issues' in error)) return undefined;
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return undefined;

  const expiredPaths = new Set<DedicatedExpiryPath>();
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') return undefined;
    const path = (issue as { path?: unknown }).path;
    const message = (issue as { message?: unknown }).message;
    if (!Array.isArray(path) || path.length !== 1 || typeof path[0] !== 'string') return undefined;
    if (!dedicatedExpiryPaths.has(path[0] as DedicatedExpiryPath)) return undefined;
    if (message !== `${path[0]} must be in the future`) return undefined;
    expiredPaths.add(path[0] as DedicatedExpiryPath);
  }
  return [...expiredPaths];
};

const restoreValidatedExpiredDate = (rawValue: string | undefined) => {
  if (!rawValue) throw new Error('validated dedicated expiry is unexpectedly absent');
  return new Date(rawValue);
};

/**
 * Dedicated HML discovery/Daily-6 bearer credentials are rejected by request
 * authentication once their expiresAt timestamp passes. Expiry therefore must not
 * make the public health/readiness process unavailable.
 *
 * The shared parser remains the source of truth. We first run it unchanged and only
 * recover when every validation issue is exactly the dedicated "must be in the
 * future" refinement. This proves syntax and every unrelated configuration rule
 * before any sentinel is substituted. The original expired Date objects are then
 * restored immediately, so request authorization stays fail-closed.
 */
export const parseApiStartupConfig = (environment: NodeJS.ProcessEnv) => {
  try {
    return parseApiConfig(environment);
  } catch (error) {
    const expiredPaths = expiredDedicatedPathsFromError(error);
    if (!expiredPaths) throw error;

    const parseEnvironment: NodeJS.ProcessEnv = { ...environment };
    const parseSentinel = new Date(Date.now() + 60_000).toISOString();
    for (const path of expiredPaths) parseEnvironment[path] = parseSentinel;

    const parsed = parseApiConfig(parseEnvironment);
    return {
      ...parsed,
      ...(expiredPaths.includes('HML_DISCOVERY_AUTH_EXPIRES_AT')
        ? { HML_DISCOVERY_AUTH_EXPIRES_AT: restoreValidatedExpiredDate(environment.HML_DISCOVERY_AUTH_EXPIRES_AT) }
        : {}),
      ...(expiredPaths.includes('HML_DAILY6_AUTH_EXPIRES_AT')
        ? { HML_DAILY6_AUTH_EXPIRES_AT: restoreValidatedExpiredDate(environment.HML_DAILY6_AUTH_EXPIRES_AT) }
        : {}),
    };
  }
};
