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
      'restore:suppression:key:recover',
      'restore:suppression:apply',
      'restore:suppression:apply',
      'restore:suppression:verify',
      'pilot:real:preflight',
    ];
    const runnerLines = restoreScript.split(/\r?\n/u).filter((line) => line.includes('npm run'));
    expect(runnerLines).toHaveLength(phases.length);
    runnerLines.forEach((line, index) => {
      expect(line).toContain('docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run');
      expect(line).toContain(phases[index]);
    });
  });

  it('keeps services stopped until key recovery, suppression apply and verification succeed', () => {
    const ordered = [
      'stop api worker',
      'restore:suppression:export',
      'restore:suppression:validate',
      'restore:suppression:key:export',
      'pg_restore -U',
      'run --rm migrate',
      'restore:suppression:key:recover',
      'restore:suppression:apply -- --manifest "$manifest_container"',
      'restore:suppression:apply -- --manifest "$manifest_container" --apply',
      'restore:suppression:verify',
      'pilot:real:preflight',
      'rm -f -- "$key_capsule"',
      'up -d api worker',
    ].map((token) => restoreScript.indexOf(token));
    expect(ordered.every((position) => position >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    expect(restoreScript).toContain('RESTORE_RESUME_SERVICES:-false');
  });

  it('keeps the HMAC recovery capsule private and ephemeral', () => {
    expect(restoreScript).toContain('umask 077');
    expect(restoreScript).toContain('key_name="$manifest_name.precontact-hmac-key"');
    expect(restoreScript).toContain('trap cleanup_key_capsule EXIT');
    expect(restoreScript).toContain('[[ ! -e "$key_capsule" ]] || die');
    expect(restoreScript).toContain('trap - EXIT');
    expect(restoreScript.indexOf('rm -f -- "$key_capsule"')).toBeLessThan(restoreScript.indexOf('up -d api worker'));
  });

  it.runIf(dockerAvailable)('renders a private, read-only, one-shot-capable runner without a published database port', () => {
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
  });
});
