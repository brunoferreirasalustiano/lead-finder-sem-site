import { parseApiConfig } from '@lead-finder/shared';

const dedicatedExpiryPaths = [
  'HML_DISCOVERY_AUTH_EXPIRES_AT',
  'HML_DAILY6_AUTH_EXPIRES_AT',
] as const;

type DedicatedExpiryPath = (typeof dedicatedExpiryPaths)[number];

const expiredDedicatedPathsFromError = (error: unknown): DedicatedExpiryPath[] | undefined => {
  if (!(error instanceof Error)) return undefined;
  const prefix = 'Invalid environment configuration: ';
  if (!error.message.startsWith(prefix)) return undefined;

  const details = error.message.slice(prefix.length).split('; ');
  if (details.length === 0) return undefined;

  const expiredPaths = new Set<DedicatedExpiryPath>();
  for (const detail of details) {
    const path = dedicatedExpiryPaths.find(
      (candidate) => detail === `${candidate}: ${candidate} must be in the future`,
    );
    if (!path) return undefined;
    expiredPaths.add(path);
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
 * recover when its complete formatted error contains exclusively the dedicated
 * "must be in the future" refinements. This proves syntax and every unrelated
 * configuration rule before any sentinel is substituted. The original expired Date
 * objects are then restored immediately, so request authorization stays fail-closed.
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
