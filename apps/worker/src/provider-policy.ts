const CNPJ_WS_DOCUMENTED_PUBLIC_MAX_RPM = 3;
const CNPJ_WS_OPERATIONAL_SAFE_RPM = 2;

/**
 * CNPJ.ws documents the public API at 3 requests/minute per IP. The hosted G6
 * evidence showed that pacing exactly on the 20-second boundary can still hit
 * the provider's rolling/boundary enforcement on the fourth request. Keep the
 * operational worker below the documented ceiling while retaining caller
 * configuration as an additional lower bound.
 */
export const safeCnpjWsPublicRpm = (configuredRpm: number): number => Math.max(
  1,
  Math.min(configuredRpm, CNPJ_WS_DOCUMENTED_PUBLIC_MAX_RPM, CNPJ_WS_OPERATIONAL_SAFE_RPM),
);
