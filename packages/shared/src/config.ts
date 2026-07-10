import { z } from 'zod';

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
});

const apiSchema = commonSchema.extend({
  API_PORT: integerFromEnvironment('API_PORT', 1, 65_535, 3000),
});

const workerSchema = commonSchema.extend({
  OVERPASS_URL: z.string().url().default('https://overpass-api.de/api/interpreter'),
  OVERPASS_TIMEOUT_MS: integerFromEnvironment('OVERPASS_TIMEOUT_MS', 1_000, 120_000, 30_000),
  OVERPASS_MAX_RETRIES: integerFromEnvironment('OVERPASS_MAX_RETRIES', 0, 10, 3),
  WORKER_POLL_INTERVAL_MS: integerFromEnvironment(
    'WORKER_POLL_INTERVAL_MS',
    1_000,
    3_600_000,
    60_000,
  ),
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

export function parseWorkerConfig(environment: NodeJS.ProcessEnv) {
  const result = workerSchema.safeParse(environment);
  if (!result.success) throw formatConfigurationError(result.error);
  return result.data;
}
