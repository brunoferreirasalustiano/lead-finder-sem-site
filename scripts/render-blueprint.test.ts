import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const blueprint = readFileSync(join(process.cwd(), 'render.yaml'), 'utf8');

describe('Render Plan B blueprint', () => {
  it('defines only the isolated homologation API with manual deploys', () => {
    expect(blueprint).toMatch(/^services:\r?\n  - type: web\r?\n    name: lead-finder-api-hml$/mu);
    expect(blueprint).toContain('    branch: hml/render-supabase-plan-b');
    expect(blueprint).toContain('    autoDeployTrigger: off');
    expect(blueprint).toContain('    plan: free');
    expect(blueprint).toContain('    healthCheckPath: /health/ready');
    expect(blueprint).not.toMatch(/^databases:/mu);
    expect(blueprint).not.toMatch(/^\s+- type: (?:worker|cron|keyvalue|redis|pserv)$/mu);
    expect(blueprint).not.toMatch(/^\s+disk:/mu);
  });

  it.each([
    ['DRY_RUN', 'true'],
    ['SHADOW_MODE_ENABLED', 'true'],
    ['REAL_SEND_ENABLED', 'false'],
    ['REAL_PROVIDERS_ENABLED', 'false'],
    ['REAL_PROVIDER_CONFIGURED', 'false'],
    ['COLLECTION_EGRESS_ENABLED', 'false'],
    ['OPERATOR_EMAIL_TEST_ENABLED', 'false'],
    ['OPERATOR_EMAIL_TEST_KILL_SWITCH_ENABLED', 'true'],
    ['DAILY_LEAD_LIMIT', '60'],
  ])('pins %s to its safe homologation value', (key, value) => {
    expect(blueprint).toContain(`{ key: ${key}, value: '${value}' }`);
  });

  it.each([
    'DATABASE_URL',
    'API_AUTH_TOKEN',
    'API_AUTH_PERMISSIONS',
    'INTERNAL_CRON_SECRET',
    'CORS_ALLOWED_ORIGINS',
    'OPERATOR_EMAIL_TEST_RECIPIENT',
    'OPERATOR_EMAIL_TEST_SENDER',
    'OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID',
    'OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET',
    'OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN',
    'OPERATOR_EMAIL_TEST_FINGERPRINT_KEY',
  ])('requires %s to be supplied outside the repository', (key) => {
    expect(blueprint).toContain(`{ key: ${key}, sync: false }`);
  });
});
