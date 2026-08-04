import { describe, expect, it } from 'vitest';
import { assertApiKillSwitchReleased, parseApiConfig, parseContactResolverConfig, parseWorkerConfig } from './config.js';

const database = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
  API_AUTH_TOKEN: 'synthetic-api-token-for-tests-only-0001',
  API_AUTH_PERMISSIONS: 'pilot:read,pilot:write,pilot:review,pilot:record-contact,pilot:record-result',
};

describe('environment configuration', () => {
  it('requires local manual no-provider contact resolution fail closed', () => {
    const safe = {
      CONTACT_RESOLVER_DATABASE_URL: database.DATABASE_URL,
      MANUAL_MESSAGING_ENABLED: 'true',
      CONTACT_RESOLUTION_KILL_SWITCH_ENABLED: 'false',
      CONTACT_RESOLUTION_MODE: 'LOCAL_MANUAL',
      CONTACT_RESOLUTION_NO_PROVIDER_MODE: 'true',
      REAL_PROVIDERS_ENABLED: 'false',
      REAL_PROVIDER_CONFIGURED: 'false',
    };
    expect(parseContactResolverConfig(safe)).toMatchObject({
      MANUAL_MESSAGING_ENABLED: true,
      CONTACT_RESOLUTION_MODE: 'LOCAL_MANUAL',
      CONTACT_RESOLUTION_NO_PROVIDER_MODE: true,
      REAL_PROVIDERS_ENABLED: false,
    });
    expect(() => parseContactResolverConfig({ ...safe, CONTACT_RESOLUTION_KILL_SWITCH_ENABLED: 'true' })).toThrow();
    expect(() => parseContactResolverConfig({ ...safe, CONTACT_RESOLUTION_NO_PROVIDER_MODE: 'false' })).toThrow();
    expect(() => parseContactResolverConfig({ ...safe, REAL_PROVIDERS_ENABLED: 'true' })).toThrow();
  });
  it('applies safe defaults', () => {
    expect(parseApiConfig(database)).toMatchObject({
      API_PORT: 3000,
      API_BATCH_PROCESSING_ENABLED: false,
      COLLECTION_EGRESS_ENABLED: false,
      PROSPECTING_METRICS_ENABLED: false,
      PILOT_KILL_SWITCH_ENABLED: true,
      API_AUTH_PERMISSIONS: ['pilot:read', 'pilot:write', 'pilot:review', 'pilot:record-contact', 'pilot:record-result'],
    });
    expect(parseWorkerConfig(database)).toMatchObject({
      COLLECTION_EGRESS_ENABLED: false,
      OVERPASS_TIMEOUT_MS: 30000,
      OVERPASS_MAX_RETRIES: 3,
      WORKER_POLL_INTERVAL_MS: 60000,
      DAILY_LEAD_LIMIT: 60,
      OUTBOX_LEASE_MS: 30000,
      CAMPAIGN_DAILY_LIMIT_EMAIL: 50,
      CAMPAIGN_DAILY_LIMIT_WHATSAPP: 50,
      CAMPAIGN_WINDOW_START_UTC: '08:00',
      CAMPAIGN_WINDOW_END_UTC: '18:00',
      CAMPAIGN_MIN_SPACING_MS: 0,
      OUTBOX_RETRY_MAX_ATTEMPTS: 5,
      OUTBOX_RETRY_BASE_MS: 1000,
      OUTBOX_RETRY_MAX_MS: 60000,
      SHADOW_MODE_ENABLED: false,
      PILOT_KILL_SWITCH_ENABLED: true,
    });
    expect(parseWorkerConfig(database).OVERPASS_API_URL).toBeUndefined();
    expect(parseWorkerConfig({ ...database, OVERPASS_API_URL: '' }).OVERPASS_API_URL).toBeUndefined();
    expect(parseApiConfig({ ...database, COLLECTION_EGRESS_ENABLED: '' }).COLLECTION_EGRESS_ENABLED).toBe(false);
    expect(parseWorkerConfig({ ...database, COLLECTION_EGRESS_ENABLED: '' }).COLLECTION_EGRESS_ENABLED).toBe(false);
  });

  it('keeps prospecting metrics disabled by default and rejects ambiguous values', () => {
    expect(parseApiConfig(database).PROSPECTING_METRICS_ENABLED).toBe(false);
    expect(parseApiConfig({ ...database, PROSPECTING_METRICS_ENABLED: 'true' }).PROSPECTING_METRICS_ENABLED).toBe(true);
    expect(() => parseApiConfig({ ...database, PROSPECTING_METRICS_ENABLED: 'yes' })).toThrow('PROSPECTING_METRICS_ENABLED');
  });

  it.each([
    ['API_PORT', 'NaN'],
    ['API_PORT', '70000'],
    ['DAILY_LEAD_LIMIT', '-1'],
  ])('rejects invalid API variable %s=%s', (name, value) => {
    expect(() => parseApiConfig({ ...database, [name]: value })).toThrow(name);
  });

  it('keeps API batch processing fail-closed unless explicitly enabled', () => {
    expect(parseApiConfig(database).API_BATCH_PROCESSING_ENABLED).toBe(false);
    expect(parseApiConfig({
      ...database,
      API_BATCH_PROCESSING_ENABLED: 'true',
    }).API_BATCH_PROCESSING_ENABLED).toBe(true);
    expect(() => parseApiConfig({
      ...database,
      API_BATCH_PROCESSING_ENABLED: 'yes',
    })).toThrow('API_BATCH_PROCESSING_ENABLED');
  });

  it.each([undefined, '', 'too-short', 'CHANGE_ME'])('rejects an unsafe API token %s', (value) => {
    expect(() => parseApiConfig({ ...database, API_AUTH_TOKEN: value })).toThrow('API_AUTH_TOKEN');
  });

  it.each([
    [undefined, 'API_AUTH_PERMISSIONS'],
    ['', 'empty entries'],
    ['pilot:read,', 'empty entries'],
    [',pilot:read', 'empty entries'],
    ['pilot:read,,pilot:write', 'empty entries'],
    ['pilot:read,pilot:read', 'duplicate permissions'],
    ['pilot:read,unknown:permission', 'unknown permission'],
    ['pilot:*', 'malformed permission'],
    [' pilot:read', 'malformed permission'],
    ['pilot:read ', 'malformed permission'],
  ])('rejects unsafe API permission configuration %s', (value, message) => {
    expect(() => parseApiConfig({ ...database, API_AUTH_PERMISSIONS: value })).toThrow(message);
  });

  it('keeps pilot completion as a separate opt-in permission', () => {
    expect(parseApiConfig(database).API_AUTH_PERMISSIONS).not.toContain('pilot:complete');
    expect(parseApiConfig({
      ...database,
      API_AUTH_PERMISSIONS: `${database.API_AUTH_PERMISSIONS},pilot:complete`,
    }).API_AUTH_PERMISSIONS).toContain('pilot:complete');
  });

  it.each([
    ['OVERPASS_TIMEOUT_MS', '999'],
    ['OVERPASS_MAX_RETRIES', '-1'],
    ['OVERPASS_MAX_RETRIES', '11'],
    ['WORKER_POLL_INTERVAL_MS', 'NaN'],
    ['DAILY_LEAD_LIMIT', '0'],
    ['OUTBOX_LEASE_MS', '999'],
    ['OUTBOX_LEASE_MS', '3600001'],
    ['CAMPAIGN_DAILY_LIMIT_EMAIL', '0'],
    ['CAMPAIGN_DAILY_LIMIT_WHATSAPP', '1000001'],
    ['CAMPAIGN_WINDOW_START_UTC', '8:00'],
    ['CAMPAIGN_WINDOW_END_UTC', '24:00'],
    ['CAMPAIGN_MIN_SPACING_MS', '-1'],
    ['OUTBOX_RETRY_MAX_ATTEMPTS', '0'],
    ['OUTBOX_RETRY_BASE_MS', '0'],
    ['OUTBOX_RETRY_MAX_MS', '604800001'],
  ])('rejects invalid worker variable %s=%s', (name, value) => {
    expect(() => parseWorkerConfig({ ...database, [name]: value })).toThrow(name);
  });

  it('rejects empty and overnight windows', () => {
    for (const [start, end] of [['18:00', '08:00'], ['08:00', '08:00']]) {
      expect(() => parseWorkerConfig({
        ...database,
        CAMPAIGN_WINDOW_START_UTC: start,
        CAMPAIGN_WINDOW_END_UTC: end,
      })).toThrow('overnight windows are not supported');
    }
  });

  it('fails closed and rejects invalid shadow mode values', () => {
    expect(parseWorkerConfig(database).SHADOW_MODE_ENABLED).toBe(false);
    expect(parseApiConfig(database).REAL_PROVIDER_CONFIGURED).toBe(false);
    expect(parseApiConfig({ ...database, REAL_PROVIDER_CONFIGURED: 'true' }).REAL_PROVIDER_CONFIGURED).toBe(true);
    expect(() => parseApiConfig({ ...database, REAL_PROVIDER_CONFIGURED: 'yes' })).toThrow('REAL_PROVIDER_CONFIGURED');
    expect(parseWorkerConfig({ ...database, SHADOW_MODE_ENABLED: 'true' })).toMatchObject({
      SHADOW_MODE_ENABLED: true,
      COLLECTION_EGRESS_ENABLED: false,
    });
    expect(parseWorkerConfig({ ...database, SHADOW_MODE_ENABLED: 'false' }).SHADOW_MODE_ENABLED).toBe(false);
    expect(() => parseWorkerConfig({ ...database, SHADOW_MODE_ENABLED: 'yes' })).toThrow('SHADOW_MODE_ENABLED');
    expect(parseWorkerConfig({ ...database, PILOT_KILL_SWITCH_ENABLED: 'true' }).PILOT_KILL_SWITCH_ENABLED).toBe(true);
    expect(() => parseWorkerConfig({ ...database, PILOT_KILL_SWITCH_ENABLED: 'yes' })).toThrow('PILOT_KILL_SWITCH_ENABLED');
    expect(parseApiConfig({ ...database, PILOT_KILL_SWITCH_ENABLED: 'true' }).PILOT_KILL_SWITCH_ENABLED).toBe(true);
    expect(parseApiConfig({ ...database, PILOT_KILL_SWITCH_ENABLED: 'false' }).PILOT_KILL_SWITCH_ENABLED).toBe(false);
    expect(() => parseApiConfig({ ...database, PILOT_KILL_SWITCH_ENABLED: 'yes' })).toThrow('PILOT_KILL_SWITCH_ENABLED');
    expect(() => assertApiKillSwitchReleased(true)).toThrow('PILOT_KILL_SWITCH_ENGAGED');
    expect(() => assertApiKillSwitchReleased(false)).not.toThrow();
  });

  it('requires an explicit Overpass URL only when collection egress is enabled', () => {
    expect(() => parseApiConfig({
      ...database,
      COLLECTION_EGRESS_ENABLED: 'true',
    })).toThrow('OVERPASS_API_URL is required when COLLECTION_EGRESS_ENABLED=true');

    expect(() => parseWorkerConfig({
      ...database,
      COLLECTION_EGRESS_ENABLED: 'true',
    })).toThrow('OVERPASS_API_URL is required when COLLECTION_EGRESS_ENABLED=true');

    expect(parseWorkerConfig({
      ...database,
      COLLECTION_EGRESS_ENABLED: 'true',
      OVERPASS_API_URL: 'https://overpass.example.test/api',
    })).toMatchObject({
      COLLECTION_EGRESS_ENABLED: true,
      OVERPASS_API_URL: 'https://overpass.example.test/api',
    });
    expect(() => parseWorkerConfig({
      ...database,
      COLLECTION_EGRESS_ENABLED: 'yes',
    })).toThrow('COLLECTION_EGRESS_ENABLED');
  });

  it('rejects retry base greater than retry maximum', () => {
    expect(() => parseWorkerConfig({
      ...database,
      OUTBOX_RETRY_BASE_MS: '2000',
      OUTBOX_RETRY_MAX_MS: '1000',
    })).toThrow('OUTBOX_RETRY_MAX_MS');
  });

  it('accepts both profiles and fails closed for unsafe Plan B values', () => {
    expect(parseApiConfig(database).DEPLOYMENT_PROFILE).toBe('oracle-vps');
    const planB = { ...database, DEPLOYMENT_PROFILE: 'supabase-render', SHADOW_MODE_ENABLED: 'true',
      INTERNAL_CRON_SECRET: 'synthetic-internal-cron-secret-0001' };
    expect(parseApiConfig(planB)).toMatchObject({ DEPLOYMENT_PROFILE: 'supabase-render', DRY_RUN: true,
      API_BATCH_PROCESSING_ENABLED: false, REAL_SEND_ENABLED: false,
      REAL_PROVIDERS_ENABLED: false, COLLECTION_EGRESS_ENABLED: false });
    expect(parseApiConfig({
      ...planB,
      API_BATCH_PROCESSING_ENABLED: 'true',
    }).API_BATCH_PROCESSING_ENABLED).toBe(true);
    expect(() => parseApiConfig({ ...planB, REAL_SEND_ENABLED: 'true' })).toThrow('supabase-render requires');
    expect(() => parseApiConfig({ ...planB, DAILY_LEAD_LIMIT: '61' })).toThrow('DAILY_LEAD_LIMIT');
    expect(() => parseWorkerConfig({ ...database, DEPLOYMENT_PROFILE: 'supabase-render' })).toThrow('bounded API batch endpoint');
  });

  it('accepts Render PORT and validates an explicit CORS allowlist', () => {
    expect(parseApiConfig({ ...database, PORT: '10000' }).API_PORT).toBe(10000);
    expect(parseApiConfig({ ...database, CORS_ALLOWED_ORIGINS: 'https://app.example.test,https://fallback.example.test' }).CORS_ALLOWED_ORIGINS).toEqual([
      'https://app.example.test', 'https://fallback.example.test',
    ]);
    expect(() => parseApiConfig({ ...database, CORS_ALLOWED_ORIGINS: '*' })).toThrow('CORS_ALLOWED_ORIGINS');
  });
});
