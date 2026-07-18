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
    expect(result.stderr).not.toContain(process.cwd());
    expect(result.stderr).not.toMatch(/\n\s+at\s/u);
  }, 15_000);
});
