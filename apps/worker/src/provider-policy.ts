const CNPJ_WS_DOCUMENTED_PUBLIC_MAX_RPM = 3;
const CNPJ_WS_OPERATIONAL_SAFE_RPM = 2;

/**
 * CNPJ.ws documents the public API at 3 requests/minute per IP. Hosted G6
 * evidence showed that a fourth request under the previous nominal 3-RPM
 * pacing still received HTTP 429 with Retry-After=60. Keep the operational
 * worker below the documented ceiling while retaining caller configuration as
 * an additional lower bound; do not infer the provider's internal window model.
 */
export const safeCnpjWsPublicRpm = (configuredRpm: number): number => Math.max(
  1,
  Math.min(configuredRpm, CNPJ_WS_DOCUMENTED_PUBLIC_MAX_RPM, CNPJ_WS_OPERATIONAL_SAFE_RPM),
);
