import { describe, expect, it } from 'vitest';
import {
  initialPilotGateResults,
  pilotReadinessDecision,
  validateExternalSurface,
  validatePilotHomologationEnvironment,
  validatePilotPermissions,
  validateShadowModeIsolation,
} from './pilot-real-preflight.js';

const safeEnvironment = {
  PILOT_HOMOLOGATION: 'true',
  NODE_ENV: 'homologation',
  SHADOW_MODE_ENABLED: 'true',
  POSTGRES_DB: 'leadfinder_homologation',
  PILOT_DATABASE_GUARD: 'leadfinder_homologation',
  PILOT_RESTORE_DB: 'leadfinder_homologation_restore',
  DATABASE_URL: 'postgresql://pilot_homologation:synthetic-only-password@localhost:5432/leadfinder_homologation',
  API_AUTH_TOKEN: 'synthetic-homologation-token-for-tests-0001',
  API_AUTH_PERMISSIONS: 'pilot:read,pilot:write,pilot:review,pilot:record-contact,pilot:record-result',
  REAL_PROVIDER_CONFIGURED: 'false',
  COLLECTION_EGRESS_ENABLED: 'false',
  ENABLE_N8N: 'false',
  PILOT_EXTERNAL_PROCESSING_ENABLED: 'false',
  AUTHENTICATED_COLLECTION_ENABLED: 'false',
  AUTOMATED_SENDING_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
  WHATSAPP_AUTOMATION_ENABLED: 'false',
  EMAIL_SENDING_ENABLED: 'false',
  SMS_SENDING_ENABLED: 'false',
  CAMPAIGN_EXTERNAL_CALLS_ENABLED: 'false',
};

describe('controlled real-pilot preflight invariants', () => {
  it('accepts only the exact minimum pilot permission set', () => {
    expect(validatePilotPermissions(safeEnvironment.API_AUTH_PERMISSIONS)).toMatchObject({
      status: 'PASS', effectivePermissions: ['pilot:read', 'pilot:write', 'pilot:review', 'pilot:record-contact', 'pilot:record-result'],
    });
    for (const unsafe of [
      'pilot:read,pilot:write,pilot:review,pilot:record-contact',
      'pilot:read,pilot:write,pilot:review,pilot:record-contact,pilot:record-result,pilot:complete',
      'pilot:read,pilot:read,pilot:review,pilot:record-contact,pilot:record-result',
      'pilot:read,,pilot:review,pilot:record-contact,pilot:record-result',
      'pilot:*',
    ]) expect(validatePilotPermissions(unsafe).status).toBe('FAIL');
  });

  it('requires a controlled, distinct homologation database and rejects production-like hosts', () => {
    expect(validatePilotHomologationEnvironment(safeEnvironment).status).toBe('PASS');
    expect(validatePilotHomologationEnvironment({ ...safeEnvironment, POSTGRES_DB: 'leadfinder' }).status).toBe('FAIL');
    expect(validatePilotHomologationEnvironment({ ...safeEnvironment, DATABASE_URL: 'postgresql://u:p@db-prod.example.test:5432/leadfinder_homologation' }).status).toBe('FAIL');
    expect(validatePilotHomologationEnvironment({ ...safeEnvironment, PILOT_RESTORE_DB: 'leadfinder_homologation' }).status).toBe('FAIL');
    expect(validatePilotHomologationEnvironment({ ...safeEnvironment, API_AUTH_TOKEN: 'REPLACE_WITH_A_LOCAL_TOKEN_THAT_IS_LONG_ENOUGH' }).status).toBe('FAIL');
    expect(validatePilotHomologationEnvironment({}).status).toBe('NOT RUN');
  });

  it('keeps shadow true only in the controlled homologation configuration', () => {
    expect(validateShadowModeIsolation({
      development: { SHADOW_MODE_ENABLED: 'false' },
      production: { SHADOW_MODE_ENABLED: 'false' },
      homologation: { SHADOW_MODE_ENABLED: 'true', PILOT_HOMOLOGATION: 'true' },
    }).status).toBe('PASS');
    expect(validateShadowModeIsolation({
      development: { SHADOW_MODE_ENABLED: 'true' },
      production: { SHADOW_MODE_ENABLED: 'false' },
      homologation: { SHADOW_MODE_ENABLED: 'true', PILOT_HOMOLOGATION: 'true' },
    }).status).toBe('FAIL');
  });

  it('fails closed if an incompatible external surface is missing or enabled', () => {
    expect(validateExternalSurface(safeEnvironment).status).toBe('PASS');
    expect(validateExternalSurface({ ...safeEnvironment, WEBHOOKS_ENABLED: 'true' }).status).toBe('FAIL');
    expect(validateExternalSurface({ ...safeEnvironment, SMS_SENDING_ENABLED: undefined }).status).toBe('NOT RUN');
  });

  it('never emits ready while one mandatory gate is not pass', () => {
    const gates = initialPilotGateResults();
    expect(pilotReadinessDecision(gates)).toBe('PILOT_REAL_NOT_READY');
    for (const name of Object.keys(gates) as (keyof typeof gates)[]) gates[name] = 'PASS';
    expect(pilotReadinessDecision(gates)).toBe('PILOT_REAL_READY');
  });
});
