import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildPilotRealPreflightReport, parseEnvironmentFile } from './pilot-real-preflight.js';

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
    expect(compose).toContain('profiles: !reset [disabled]');
  });
});
