import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const restoreScript = readFileSync('scripts/restore-postgres.sh', 'utf8');
const dockerAvailable = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

describe('production restore suppression orchestration', () => {
  it('runs every Node reconciliation phase in the one-shot Compose runner', () => {
    const phases = [
      'restore:suppression:export',
      'restore:suppression:validate',
      'restore:suppression:key:export',
      'restore:suppression:legacy:prepare',
      'restore:suppression:key:recover',
      'restore:suppression:apply',
      'restore:suppression:apply',
      'restore:suppression:verify',
      'pilot:real:preflight',
    ];
    const runnerLines = restoreScript.split(/\r?\n/u).filter((line) => line.includes('npm run'));
    expect(runnerLines).toHaveLength(phases.length);
    runnerLines.forEach((line, index) => expect(line).toContain(phases[index]));
  });

  it('bridges true pre-0048 legacy suppressions before migration 0048 can run', () => {
    const ordered = [
      'stop api worker',
      'restore:suppression:export',
      'restore:suppression:validate',
      'precontact_hmac_key="$(',
      'restore:suppression:key:export',
      'pg_restore -U',
      'restore:suppression:legacy:prepare',
      'run --rm migrate',
      'restore:suppression:key:recover',
      "precontact_hmac_key=''",
      'unset precontact_hmac_key',
      'restore:suppression:apply -- --manifest "$manifest_container"',
      'restore:suppression:apply -- --manifest "$manifest_container" --apply',
      'restore:suppression:verify',
      'pilot:real:preflight',
      'up -d api worker',
    ].map((token) => restoreScript.indexOf(token));
    expect(ordered.every((position) => position >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    expect(restoreScript).toContain('RESTORE_RESUME_SERVICES:-false');
  });

  it('never materializes the HMAC recovery key on disk or in argv/env', () => {
    expect(restoreScript).toContain('set +x');
    expect(restoreScript).toContain('precontact_hmac_key="$(');
    expect(restoreScript).toContain('npm run --silent restore:suppression:key:export -- --manifest "$manifest_container"');
    expect(restoreScript).toContain('npm run --silent restore:suppression:legacy:prepare -- --manifest "$manifest_container"');
    expect(restoreScript).toContain('npm run --silent restore:suppression:key:recover -- --manifest "$manifest_container"');
    expect(restoreScript.match(/builtin printf '%s\\n' \"\$precontact_hmac_key\" \|/gu)).toHaveLength(2);
    expect(restoreScript).toContain("precontact_hmac_key=''");
    expect(restoreScript).toContain('unset precontact_hmac_key');
    expect(restoreScript).not.toContain('key_capsule');
    expect(restoreScript).not.toContain('key_container');
    expect(restoreScript).not.toContain('.precontact-hmac-key');
    expect(restoreScript).not.toContain('--key-file');
    expect(restoreScript.indexOf('unset precontact_hmac_key')).toBeLessThan(
      restoreScript.indexOf('restore:suppression:apply -- --manifest "$manifest_container"'),
    );
    expect(restoreScript.indexOf('unset precontact_hmac_key')).toBeLessThan(restoreScript.indexOf('up -d api worker'));
  });

  it.runIf(dockerAvailable)('renders a private, read-only, no-log one-shot runner without a published database port', () => {
    const output = execFileSync(
      'docker',
      ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.production.yml', '--profile', 'tools', 'config', '--format', 'json'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          POSTGRES_PASSWORD: 'compose-test-only',
          DATABASE_URL: 'postgresql://leadfinder:compose-test-only@postgres:5432/leadfinder',
          API_AUTH_TOKEN: 'synthetic-compose-token',
          API_AUTH_PERMISSIONS: 'pilot:read',
          SHADOW_MODE_ENABLED: 'true',
          PILOT_KILL_SWITCH_ENABLED: 'true',
        },
      },
    );
    const config = JSON.parse(output) as { services: Record<string, Record<string, unknown>> };
    const postgres = config.services['postgres']!;
    const runner = config.services['restore-suppression']!;
    expect(postgres['ports']).toBeUndefined();
    expect(runner['ports']).toBeUndefined();
    expect(runner['networks']).toHaveProperty('database');
    expect(runner['read_only']).toBe(true);
    expect(runner['cap_drop']).toContain('ALL');
    expect(runner['environment']).toEqual({ DATABASE_URL: 'postgresql://leadfinder:compose-test-only@postgres:5432/leadfinder' });
    expect(runner['logging']).toEqual({ driver: 'none' });
  });
});
