import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPilotRealPreflightReport, parseEnvironmentFile } from './pilot-real-preflight.js';

const execFileAsync = promisify(execFile);
const dockerComposeAvailable = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

const environment = {
  PILOT_HOMOLOGATION: 'true', NODE_ENV: 'homologation', SHADOW_MODE_ENABLED: 'true',
  POSTGRES_DB: 'leadfinder_homologation', PILOT_DATABASE_GUARD: 'leadfinder_homologation',
  PILOT_RESTORE_DB: 'leadfinder_homologation_restore',
  DATABASE_URL: 'postgresql://pilot:synthetic-password@localhost:5432/leadfinder_homologation',
  API_AUTH_TOKEN: 'synthetic-homologation-token-for-tests-0001',
  API_AUTH_PERMISSIONS: 'pilot:read,pilot:write,pilot:review,pilot:record-contact,pilot:record-result',
  REAL_PROVIDER_CONFIGURED: 'false', COLLECTION_EGRESS_ENABLED: 'false', ENABLE_N8N: 'false',
  PILOT_EXTERNAL_PROCESSING_ENABLED: 'false', AUTHENTICATED_COLLECTION_ENABLED: 'false',
  AUTOMATED_SENDING_ENABLED: 'false', WEBHOOKS_ENABLED: 'false', WHATSAPP_AUTOMATION_ENABLED: 'false',
  EMAIL_SENDING_ENABLED: 'false', SMS_SENDING_ENABLED: 'false', CAMPAIGN_EXTERNAL_CALLS_ENABLED: 'false',
};

describe('pilot real preflight report', () => {
  it('is fail-closed and cannot emit ready with any incomplete gate', () => {
    const report = buildPilotRealPreflightReport({
      environment, shadowIsolation: { status: 'PASS' }, syntheticBatchStatus: 'PASS',
    });
    expect(report.decision).toBe('PILOT_REAL_NOT_READY');
    expect(report.gates.GATE_BACKUP_RESTORE).toBe('NOT RUN');
  });

  it('emits ready only with complete, independent evidence for every gate', () => {
    const evidence = (gate: 'GATE_BACKUP_RESTORE' | 'GATE_ROLLBACK' | 'GATE_KILL_SWITCH') => ({ gate, status: 'PASS' as const });
    const report = buildPilotRealPreflightReport({
      environment, shadowIsolation: { status: 'PASS' }, backupRestore: evidence('GATE_BACKUP_RESTORE'),
      rollback: evidence('GATE_ROLLBACK'), killSwitch: evidence('GATE_KILL_SWITCH'), logPrivacy: { status: 'PASS' },
      manualApproval: {
        status: 'APPROVED', segment: 'synthetic', region: 'Campinas/SP', channel: 'manual', responsible: 'synthetic-operator',
        version: 'v1', approvedAt: '2030-01-01T00:00:00Z', approvedText: 'Synthetic approved text', suspensionCriteria: 'Any opt-out',
      }, syntheticBatchStatus: 'PASS',
    });
    expect(report.decision).toBe('PILOT_REAL_READY');
    expect(Object.values(report.gates)).toEqual(Array(10).fill('PASS'));
  });

  it('parses env files without evaluating values and rejects duplicate keys', () => {
    expect(parseEnvironmentFile('TOKEN=$(unsafe)\nVALUE="safe"\n')).toEqual({ TOKEN: '$(unsafe)', VALUE: 'safe' });
    expect(() => parseEnvironmentFile('A=1\nA=2\n')).toThrow('INVALID_HOMOLOGATION_ENV_FILE');
  });

  it('keeps shadow mode and all incompatible external capabilities in the homologation-only override', async () => {
    const compose = await readFile('docker-compose.homologation.yml', 'utf8');
    expect(compose).toContain("SHADOW_MODE_ENABLED: 'true'");
    for (const capability of [
      'REAL_PROVIDER_CONFIGURED', 'COLLECTION_EGRESS_ENABLED', 'ENABLE_N8N', 'PILOT_EXTERNAL_PROCESSING_ENABLED',
      'AUTHENTICATED_COLLECTION_ENABLED', 'AUTOMATED_SENDING_ENABLED', 'WEBHOOKS_ENABLED',
      'WHATSAPP_AUTOMATION_ENABLED', 'EMAIL_SENDING_ENABLED', 'SMS_SENDING_ENABLED', 'CAMPAIGN_EXTERNAL_CALLS_ENABLED',
    ]) expect(compose).toContain(`${capability}: 'false'`);
    expect(compose).toMatch(/profiles:\s*\n\s*- disabled/u);
    expect(compose).not.toContain('!reset');
  });

  it('fails closed when n8n is enabled in the pilot environment', () => {
    const report = buildPilotRealPreflightReport({
      environment: { ...environment, ENABLE_N8N: 'true' }, shadowIsolation: { status: 'PASS' }, syntheticBatchStatus: 'PASS',
    });
    expect(report.gates.GATE_EXTERNAL_SURFACE_DISABLED).toBe('FAIL');
    expect(report.decision).toBe('PILOT_REAL_NOT_READY');
  });

  it('keeps n8n outside the default Compose service set in the rendered homologation configuration', async () => {
    const compose = await readFile('docker-compose.homologation.yml', 'utf8');
    expect(compose).toMatch(/profiles:\s*\n\s*- disabled/u);
    expect(compose).not.toContain('!reset');
    if (!dockerComposeAvailable) return;

    const directory = await mkdtemp(join(tmpdir(), 'pilot-compose-config-'));
    const environmentFile = join(directory, 'synthetic.env');
    await writeFile(environmentFile, [
      'POSTGRES_DB=leadfinder_homologation',
      'POSTGRES_USER=pilot',
      'POSTGRES_PASSWORD=synthetic-postgres-password',
      'API_AUTH_TOKEN=synthetic-homologation-token',
      'API_AUTH_PERMISSIONS=pilot:read,pilot:write,pilot:review,pilot:record-contact,pilot:record-result',
      'SHADOW_MODE_ENABLED=true',
      'PILOT_KILL_SWITCH_ENABLED=false',
    ].join('\n').concat('\n'), 'utf8');
    const composeArguments = ['compose', '--env-file', environmentFile, '-f', 'docker-compose.yml', '-f', 'docker-compose.homologation.yml'];
    try {
      const rendered = await execFileAsync('docker', [...composeArguments, 'config', '--format', 'json']);
      const defaultConfiguration = JSON.parse(rendered.stdout) as { services: Record<string, { profiles?: unknown }> };
      expect(defaultConfiguration.services.n8n).toBeUndefined();

      const profiled = await execFileAsync('docker', ['compose', '--profile', 'disabled', ...composeArguments.slice(1), 'config', '--format', 'json']);
      const profiledConfiguration = JSON.parse(profiled.stdout) as { services: Record<string, { profiles?: unknown }> };
      expect(profiledConfiguration.services.n8n.profiles).toEqual(expect.arrayContaining(['disabled']));

      const dryRun = await execFileAsync('docker', [...composeArguments, 'up', '--dry-run', '--no-build']);
      expect(`${dryRun.stdout}\n${dryRun.stderr}`).not.toMatch(/\bn8n\b/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
