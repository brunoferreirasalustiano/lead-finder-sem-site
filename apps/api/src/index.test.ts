import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const entrypoint = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const apiEntrypoint = join(process.cwd(), 'apps', 'api', 'src', 'index.ts');
const baseEnvironment = {
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:1/synthetic',
  API_AUTH_TOKEN: 'synthetic-api-token-for-tests-only-0001',
  API_AUTH_PERMISSIONS: 'pilot:read',
};

describe('API startup kill switch', () => {
  it('keeps the documented local template explicitly released', () => {
    const template = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    expect(template.match(/^PILOT_KILL_SWITCH_ENABLED=.*$/gmu)).toEqual([
      'PILOT_KILL_SWITCH_ENABLED=false',
    ]);
  });

  it.each([
    ['an absent flag', undefined, 'PILOT_KILL_SWITCH_ENGAGED'],
    ['an engaged flag', 'true', 'PILOT_KILL_SWITCH_ENGAGED'],
    ['an invalid flag', 'yes', 'INVALID_CONFIGURATION'],
  ])('blocks startup for %s without emitting a stack trace', (_case, value, reason) => {
    const environment: NodeJS.ProcessEnv = { ...process.env, ...baseEnvironment };
    if (value === undefined) delete environment.PILOT_KILL_SWITCH_ENABLED;
    else environment.PILOT_KILL_SWITCH_ENABLED = value;

    const result = spawnSync(process.execPath, [entrypoint, apiEntrypoint], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: environment,
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('api_startup_blocked');
    expect(result.stderr).toContain(reason);
    expect(result.stderr).toContain("stage: 'API_CONFIG'");
    if (reason === 'INVALID_CONFIGURATION') {
      expect(result.stderr).toContain('PILOT_KILL_SWITCH_ENABLED');
    }
    expect(result.stderr).not.toContain(process.cwd());
    expect(result.stderr).not.toMatch(/\n\s+at\s/u);
  }, 15_000);
});

describe('API startup configuration diagnostics', () => {
  it('identifies an expired HML email credential without logging credential values', () => {
    const tokenHash = 'a'.repeat(64);
    const principalId = 'hml-email-startup-diagnostic';
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...baseEnvironment,
      PILOT_KILL_SWITCH_ENABLED: 'false',
      HML_EMAIL_AUTH_ENABLED: 'true',
      HML_EMAIL_AUTH_TOKEN_HASH: tokenHash,
      HML_EMAIL_AUTH_EXPIRES_AT: '2000-01-01T00:00:00Z',
      HML_EMAIL_AUTH_PRINCIPAL_ID: principalId,
    };

    const result = spawnSync(process.execPath, [entrypoint, apiEntrypoint], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: environment,
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('api_startup_blocked');
    expect(result.stderr).toContain("stage: 'HML_EMAIL_AUTH'");
    expect(result.stderr).toContain('HML_EMAIL_AUTH_EXPIRES_AT');
    expect(result.stderr).not.toContain(tokenHash);
    expect(result.stderr).not.toContain(principalId);
    expect(result.stderr).not.toContain(process.cwd());
    expect(result.stderr).not.toMatch(/\n\s+at\s/u);
  }, 15_000);

  it('identifies an expired HML metrics credential without logging credential values', () => {
    const tokenHash = 'b'.repeat(64);
    const principalId = 'hml-metrics-startup-diagnostic';
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...baseEnvironment,
      PILOT_KILL_SWITCH_ENABLED: 'false',
      HML_METRICS_AUTH_ENABLED: 'true',
      HML_METRICS_AUTH_TOKEN_HASH: tokenHash,
      HML_METRICS_AUTH_EXPIRES_AT: '2000-01-01T00:00:00Z',
      HML_METRICS_AUTH_PRINCIPAL_ID: principalId,
    };

    const result = spawnSync(process.execPath, [entrypoint, apiEntrypoint], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: environment,
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('api_startup_blocked');
    expect(result.stderr).toContain("stage: 'HML_METRICS_AUTH'");
    expect(result.stderr).toContain('HML_METRICS_AUTH_EXPIRES_AT');
    expect(result.stderr).not.toContain(tokenHash);
    expect(result.stderr).not.toContain(principalId);
    expect(result.stderr).not.toContain(process.cwd());
    expect(result.stderr).not.toMatch(/\n\s+at\s/u);
  }, 15_000);
});
