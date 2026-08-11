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
      HML_SUPPRESSION_PROBE_ENABLED: false,
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

  it('allows the suppression harness only in HML', () => {
    expect(parseApiConfig({ ...database, DEPLOYMENT_ENVIRONMENT: 'homologation', HML_SUPPRESSION_PROBE_ENABLED: 'true' }).HML_SUPPRESSION_PROBE_ENABLED).toBe(true);
    expect(() => parseApiConfig({ ...database, DEPLOYMENT_ENVIRONMENT: 'production', HML_SUPPRESSION_PROBE_ENABLED: 'true' })).toThrow('HML_SUPPRESSION_PROBE_ENABLED');
    expect(() => parseApiConfig({ ...database, HML_SUPPRESSION_PROBE_ENABLED: 'yes' })).toThrow('HML_SUPPRESSION_PROBE_ENABLED');
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

  it('fails closed for partial, expired, or non-homologation HML smoke authentication', () => {
    const enabled = {
      ...database,
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      HML_SMOKE_AUTH_ENABLED: 'true',
      HML_SMOKE_AUTH_TOKEN_HASH: 'a'.repeat(64),
      HML_SMOKE_AUTH_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
      HML_SMOKE_AUTH_PRINCIPAL_ID: 'hml-smoke-test',
    };
    expect(parseApiConfig(enabled)).toMatchObject({
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      HML_SMOKE_AUTH_ENABLED: true,
      HML_SMOKE_AUTH_TOKEN_HASH: 'a'.repeat(64),
      HML_SMOKE_AUTH_PRINCIPAL_ID: 'hml-smoke-test',
    });
    expect(() => parseApiConfig({ ...enabled, DEPLOYMENT_ENVIRONMENT: 'production' })).toThrow('DEPLOYMENT_ENVIRONMENT');
    expect(() => parseApiConfig({ ...enabled, DEPLOYMENT_ENVIRONMENT: undefined })).toThrow('DEPLOYMENT_ENVIRONMENT');
    expect(() => parseApiConfig({ ...enabled, HML_SMOKE_AUTH_EXPIRES_AT: new Date(Date.now() - 1_000).toISOString() })).toThrow('must be in the future');
    expect(() => parseApiConfig({ ...enabled, HML_SMOKE_AUTH_TOKEN_HASH: 'not-a-hash' })).toThrow('HML_SMOKE_AUTH_TOKEN_HASH');
    expect(() => parseApiConfig({ ...database, HML_SMOKE_AUTH_TOKEN_HASH: 'a'.repeat(64) })).toThrow('HML_SMOKE_AUTH_ENABLED');
    expect(() => parseApiConfig({ ...enabled, HML_SMOKE_AUTH_PRINCIPAL_ID: 'operator' })).toThrow('HML_SMOKE_AUTH_PRINCIPAL_ID');
  });

  it('fails closed for partial, expired, or non-homologation HML operator authentication', () => {
    const enabled = {
      ...database,
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      HML_OPERATOR_AUTH_ENABLED: 'true',
      HML_OPERATOR_AUTH_TOKEN_HASH: 'b'.repeat(64),
      HML_OPERATOR_AUTH_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
      HML_OPERATOR_AUTH_PRINCIPAL_ID: 'hml-internal-whatsapp-operator',
    };
    expect(parseApiConfig(enabled)).toMatchObject({
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      HML_OPERATOR_AUTH_ENABLED: true,
      HML_OPERATOR_AUTH_TOKEN_HASH: 'b'.repeat(64),
      HML_OPERATOR_AUTH_PRINCIPAL_ID: 'hml-internal-whatsapp-operator',
    });
    expect(() => parseApiConfig({ ...enabled, DEPLOYMENT_ENVIRONMENT: 'production' })).toThrow('DEPLOYMENT_ENVIRONMENT');
    expect(() => parseApiConfig({ ...enabled, DEPLOYMENT_ENVIRONMENT: undefined })).toThrow('DEPLOYMENT_ENVIRONMENT');
    expect(() => parseApiConfig({ ...enabled, HML_OPERATOR_AUTH_EXPIRES_AT: new Date(Date.now() - 1_000).toISOString() })).toThrow('must be in the future');
    expect(() => parseApiConfig({ ...enabled, HML_OPERATOR_AUTH_TOKEN_HASH: 'not-a-hash' })).toThrow('HML_OPERATOR_AUTH_TOKEN_HASH');
    expect(() => parseApiConfig({ ...database, HML_OPERATOR_AUTH_TOKEN_HASH: 'b'.repeat(64) })).toThrow('HML_OPERATOR_AUTH_ENABLED');
    expect(() => parseApiConfig({ ...enabled, HML_OPERATOR_AUTH_PRINCIPAL_ID: 'operator' })).toThrow('HML_OPERATOR_AUTH_PRINCIPAL_ID');
    expect(() => parseApiConfig({
      ...enabled,
      HML_SMOKE_AUTH_ENABLED: 'true',
      HML_SMOKE_AUTH_TOKEN_HASH: 'b'.repeat(64),
      HML_SMOKE_AUTH_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
      HML_SMOKE_AUTH_PRINCIPAL_ID: 'hml-smoke-test',
    })).toThrow('must differ');
    expect(() => parseApiConfig({
      ...enabled,
      HML_SMOKE_AUTH_ENABLED: 'true',
      HML_SMOKE_AUTH_TOKEN_HASH: 'c'.repeat(64),
      HML_SMOKE_AUTH_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
      HML_SMOKE_AUTH_PRINCIPAL_ID: 'hml-internal-whatsapp-operator',
    })).toThrow('must differ');
  });

  it('keeps WhatsApp Cloud API disabled by default and HML-only when enabled', () => {
    expect(parseApiConfig(database)).toMatchObject({
      WHATSAPP_CLOUD_API_ENABLED: false,
      WHATSAPP_CLOUD_MAX_SENDS: 1,
      WHATSAPP_CLOUD_TEST_SCOPE: 'HML_TEST_002',
      WHATSAPP_CLOUD_API_VERSION: 'v23.0',
    });
    const enabled = {
      ...database,
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      WHATSAPP_CLOUD_API_ENABLED: 'true',
      WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456789012345',
      WHATSAPP_CLOUD_WABA_ID: '987654321098765',
      WHATSAPP_CLOUD_ACCESS_TOKEN: 'synthetic-cloud-access-token-012345678901234567890123',
      WHATSAPP_CLOUD_TEST_RECIPIENT: '+5519971519337',
      WHATSAPP_CLOUD_MAX_SENDS: '1',
      WHATSAPP_CLOUD_TEST_SCOPE: 'HML_TEST_002',
    };
    expect(parseApiConfig(enabled)).toMatchObject({
      WHATSAPP_CLOUD_API_ENABLED: true,
      WHATSAPP_CLOUD_MAX_SENDS: 1,
      WHATSAPP_CLOUD_TEST_RECIPIENT: '+5519971519337',
    });
    expect(() => parseApiConfig({ ...enabled, DEPLOYMENT_ENVIRONMENT: 'production' }))
      .toThrow('WhatsApp Cloud API is permitted only');
    expect(() => parseApiConfig({ ...enabled, WHATSAPP_CLOUD_ACCESS_TOKEN: undefined }))
      .toThrow('WHATSAPP_CLOUD_ACCESS_TOKEN');
    expect(() => parseApiConfig({ ...enabled, WHATSAPP_CLOUD_MAX_SENDS: '2' }))
      .toThrow('WHATSAPP_CLOUD_MAX_SENDS');
    expect(() => parseApiConfig({ ...enabled, WHATSAPP_CLOUD_TEST_SCOPE: 'HML_TEST_003' }))
      .toThrow('WHATSAPP_CLOUD_TEST_SCOPE');
    expect(() => parseApiConfig({ ...database, WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456789012345' }))
      .toThrow('must be configured together');
    expect(() => parseApiConfig({
      ...enabled,
      WHATSAPP_CLOUD_ACCESS_TOKEN: database.API_AUTH_TOKEN,
    })).toThrow('must differ from API_AUTH_TOKEN');
  });

  it('keeps the real operator email test bound to one internal mailbox', () => {
    const enabled = {
      ...database,
      API_AUTH_PERMISSIONS: `${database.API_AUTH_PERMISSIONS},operator-email-test:send`,
      OPERATOR_EMAIL_TEST_ENABLED: 'true',
      OPERATOR_EMAIL_TEST_KILL_SWITCH_ENABLED: 'false',
      OPERATOR_EMAIL_TEST_RECIPIENT: 'operator@example.test',
      OPERATOR_EMAIL_TEST_SENDER: 'operator@example.test',
      OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID: '123456789-synthetic.apps.googleusercontent.com',
      OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET: 'synthetic-client-secret-0001',
      OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN: 'synthetic-refresh-token-0001',
      OPERATOR_EMAIL_TEST_FINGERPRINT_KEY: 'operator-email-test-fingerprint-key-0001',
    };
    expect(parseApiConfig(enabled)).toMatchObject({
      OPERATOR_EMAIL_TEST_ENABLED: true,
      OPERATOR_EMAIL_TEST_KILL_SWITCH_ENABLED: false,
      OPERATOR_EMAIL_TEST_RECIPIENT: 'operator@example.test',
    });
    expect(() => parseApiConfig({
      ...enabled,
      OPERATOR_EMAIL_TEST_RECIPIENT: 'lead@example.test',
    })).toThrow('operator email test sender and recipient must be identical');
    expect(() => parseApiConfig({
      ...enabled,
      OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET: undefined,
    })).toThrow('OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET');
    expect(() => parseApiConfig({
      ...database,
      OPERATOR_EMAIL_TEST_RECIPIENT: 'operator@example.test',
    })).toThrow('OPERATOR_EMAIL_TEST_ENABLED must be true');
  });

  it('accepts Gmail API configuration without SMTP credentials', () => {
    const enabled = {
      ...database,
      OPERATOR_EMAIL_TEST_ENABLED: 'true',
      OPERATOR_EMAIL_TEST_RECIPIENT: 'operator@example.test',
      OPERATOR_EMAIL_TEST_SENDER: 'operator@example.test',
      OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID: '123456789-synthetic.apps.googleusercontent.com',
      OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET: 'synthetic-client-secret-0001',
      OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN: 'synthetic-refresh-token-0001',
      OPERATOR_EMAIL_TEST_FINGERPRINT_KEY: 'operator-email-test-fingerprint-key-0001',
    };
    expect(parseApiConfig(enabled)).toMatchObject({
      OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID: '123456789-synthetic.apps.googleusercontent.com',
      OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET: 'synthetic-client-secret-0001',
      OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN: 'synthetic-refresh-token-0001',
    });
  });

  it.each([
    ['OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET', 'synthetic-api-token-for-tests-only-0001'],
    ['OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN', 'synthetic-api-token-for-tests-only-0001'],
    ['OPERATOR_EMAIL_TEST_FINGERPRINT_KEY', 'synthetic-api-token-for-tests-only-0001'],
  ])('rejects reuse of API_AUTH_TOKEN in %s', (name, value) => {
    const enabled = {
      ...database,
      OPERATOR_EMAIL_TEST_ENABLED: 'true',
      OPERATOR_EMAIL_TEST_RECIPIENT: 'operator@example.test',
      OPERATOR_EMAIL_TEST_SENDER: 'operator@example.test',
      OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_ID: '123456789-synthetic.apps.googleusercontent.com',
      OPERATOR_EMAIL_TEST_GOOGLE_CLIENT_SECRET: 'synthetic-client-secret-0001',
      OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN: 'synthetic-refresh-token-0001',
      OPERATOR_EMAIL_TEST_FINGERPRINT_KEY: 'operator-email-test-fingerprint-key-0001',
      [name]: value,
    };
    expect(() => parseApiConfig(enabled)).toThrow(name);
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

  it('keeps discovery and Daily-6 principals separate and least-privileged', () => {
    const enabled = {
      ...database,
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      HML_DISCOVERY_AUTH_ENABLED: 'true',
      HML_DISCOVERY_AUTH_TOKEN_HASH: 'd'.repeat(64),
      HML_DISCOVERY_AUTH_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
      HML_DISCOVERY_AUTH_PRINCIPAL_ID: 'hml-discovery-runner',
      HML_DAILY6_AUTH_ENABLED: 'true',
      HML_DAILY6_AUTH_TOKEN_HASH: 'e'.repeat(64),
      HML_DAILY6_AUTH_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
      HML_DAILY6_AUTH_PRINCIPAL_ID: 'hml-daily6-runner',
      DAILY6_PILOT_ENABLED: 'true',
      EXPECTED_OPERATIONAL_SHA: 'a'.repeat(40),
      MANUAL_EMAIL_SEND_ENABLED: 'true',
      MANUAL_EMAIL_KILL_SWITCH_ENABLED: 'false',
      MANUAL_EMAIL_SENDER: 'leadfinderbrasil@gmail.com',
      MANUAL_EMAIL_GOOGLE_CLIENT_ID: 'client-id',
      MANUAL_EMAIL_GOOGLE_CLIENT_SECRET: 'client-secret-000000',
      MANUAL_EMAIL_GOOGLE_REFRESH_TOKEN: 'refresh-token-000000',
      MANUAL_EMAIL_FINGERPRINT_KEY: 'fingerprint-key-000000000000000000000000000000',
      CAMPAIGN_DAILY_LIMIT_EMAIL: '6',
    };
    expect(parseApiConfig(enabled)).toMatchObject({
      HML_DISCOVERY_AUTH_ENABLED: true,
      HML_DAILY6_AUTH_ENABLED: true,
      EXPECTED_OPERATIONAL_SHA: 'a'.repeat(40),
    });
    expect(() => parseApiConfig({ ...enabled, DEPLOYMENT_ENVIRONMENT: 'production' })).toThrow('DEPLOYMENT_ENVIRONMENT');
    expect(() => parseApiConfig({ ...enabled, HML_DISCOVERY_AUTH_PRINCIPAL_ID: 'hml-daily6-runner' })).toThrow('must differ');
    expect(() => parseApiConfig({ ...enabled, HML_DAILY6_AUTH_EXPIRES_AT: new Date(Date.now() - 1_000).toISOString() })).toThrow('must be in the future');
    expect(() => parseApiConfig({ ...enabled, EXPECTED_OPERATIONAL_SHA: undefined })).toThrow('EXPECTED_OPERATIONAL_SHA');
  });

  it('keeps enrichment egress disabled by default and rejects unsafe production activation', () => {
    expect(parseWorkerConfig(database)).toMatchObject({ ENRICHMENT_EGRESS_ENABLED: false });
    expect(() => parseWorkerConfig({
      ...database,
      ENRICHMENT_EGRESS_ENABLED: 'true',
    })).toThrow('ENRICHMENT_API_URL is required when ENRICHMENT_EGRESS_ENABLED=true');
    expect(parseWorkerConfig({
      ...database,
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      ENRICHMENT_EGRESS_ENABLED: 'true',
      ENRICHMENT_API_URL: 'https://enrichment.example.test/v1',
    })).toMatchObject({ ENRICHMENT_EGRESS_ENABLED: true });
    expect(() => parseWorkerConfig({
      ...database,
      DEPLOYMENT_ENVIRONMENT: 'production',
      ENRICHMENT_EGRESS_ENABLED: 'true',
      ENRICHMENT_API_URL: 'https://enrichment.example.test/v1',
    })).toThrow('ENRICHMENT_EGRESS_ENABLED is not permitted in production');
    expect(() => parseWorkerConfig({
      ...database,
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      ENRICHMENT_EGRESS_ENABLED: 'true',
      ENRICHMENT_API_URL: 'http://enrichment.example.test/v1',
    })).toThrow('ENRICHMENT_API_URL must use HTTPS outside development');
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
    expect(() => parseApiConfig({ ...database, DAILY6_PILOT_ENABLED: 'true' })).toThrow('DAILY6_PILOT_ENABLED');
    expect(() => parseApiConfig({ ...planB, DEPLOYMENT_ENVIRONMENT: 'homologation', DAILY6_PILOT_ENABLED: 'true', EXPECTED_OPERATIONAL_SHA: 'a'.repeat(40) })).toThrow('HML_DAILY6_AUTH_ENABLED');
    expect(parseApiConfig({
      ...planB,
      API_BATCH_PROCESSING_ENABLED: 'true',
    }).API_BATCH_PROCESSING_ENABLED).toBe(true);
    expect(() => parseApiConfig({ ...planB, REAL_SEND_ENABLED: 'true' })).toThrow('supabase-render requires');
    expect(parseApiConfig({
      ...planB,
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      REAL_SEND_ENABLED: 'true',
      WHATSAPP_CLOUD_API_ENABLED: 'true',
      WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456789012345',
      WHATSAPP_CLOUD_WABA_ID: '123456789012345',
      WHATSAPP_CLOUD_ACCESS_TOKEN: 'synthetic-cloud-access-token-0000000000000001',
      WHATSAPP_CLOUD_TEST_RECIPIENT: '+15551234567',
      WHATSAPP_CLOUD_MAX_SENDS: '1',
    })).toMatchObject({ DEPLOYMENT_PROFILE: 'supabase-render', REAL_SEND_ENABLED: true });
    expect(() => parseApiConfig({
      ...planB,
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      REAL_SEND_ENABLED: 'true',
      WHATSAPP_CLOUD_API_ENABLED: 'true',
      WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456789012345',
      WHATSAPP_CLOUD_WABA_ID: '123456789012345',
      WHATSAPP_CLOUD_ACCESS_TOKEN: 'synthetic-cloud-access-token-0000000000000001',
      WHATSAPP_CLOUD_TEST_RECIPIENT: '+15551234567',
      WHATSAPP_CLOUD_MAX_SENDS: '2',
    })).toThrow('supabase-render requires');
    expect(() => parseApiConfig({ ...planB, DAILY_LEAD_LIMIT: '61' })).toThrow('DAILY_LEAD_LIMIT');
    expect(() => parseWorkerConfig({ ...database, DEPLOYMENT_PROFILE: 'supabase-render' })).toThrow('supabase-render worker is HML-only');
  });

  it('allows only the explicitly gated HML discovery egress exception', () => {
    const discovery = {
      ...database,
      DEPLOYMENT_PROFILE: 'supabase-render',
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      SHADOW_MODE_ENABLED: 'true',
      INTERNAL_CRON_SECRET: 'synthetic-internal-cron-secret-0001',
      COLLECTION_EGRESS_ENABLED: 'true',
      OVERPASS_API_URL: 'https://overpass-api.de/api/interpreter',
      HML_DISCOVERY_AUTH_ENABLED: 'true',
      HML_DISCOVERY_AUTH_TOKEN_HASH: 'a'.repeat(64),
      HML_DISCOVERY_AUTH_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
      HML_DISCOVERY_AUTH_PRINCIPAL_ID: 'hml-discovery-github',
    } as const;
    expect(parseApiConfig(discovery).COLLECTION_EGRESS_ENABLED).toBe(true);
    expect(() => parseApiConfig({
      ...discovery,
      HML_DISCOVERY_AUTH_ENABLED: 'false',
      HML_DISCOVERY_AUTH_TOKEN_HASH: undefined,
      HML_DISCOVERY_AUTH_EXPIRES_AT: undefined,
      HML_DISCOVERY_AUTH_PRINCIPAL_ID: undefined,
    })).toThrow('supabase-render requires');
  });

  it('allows Gmail only for the fully gated HML Daily-6 contract', () => {
    const daily6 = {
      ...database,
      DEPLOYMENT_PROFILE: 'supabase-render',
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      SHADOW_MODE_ENABLED: 'true',
      INTERNAL_CRON_SECRET: 'synthetic-internal-cron-secret-0001',
      DAILY6_PILOT_ENABLED: 'true',
      EXPECTED_OPERATIONAL_SHA: 'a'.repeat(40),
      HML_DISCOVERY_AUTH_ENABLED: 'true',
      HML_DISCOVERY_AUTH_TOKEN_HASH: 'c'.repeat(64),
      HML_DISCOVERY_AUTH_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
      HML_DISCOVERY_AUTH_PRINCIPAL_ID: 'hml-discovery-github',
      HML_DAILY6_AUTH_ENABLED: 'true',
      HML_DAILY6_AUTH_TOKEN_HASH: 'b'.repeat(64),
      HML_DAILY6_AUTH_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
      HML_DAILY6_AUTH_PRINCIPAL_ID: 'hml-daily6-github',
      REAL_SEND_ENABLED: 'true',
      MANUAL_EMAIL_SEND_ENABLED: 'true',
      MANUAL_EMAIL_KILL_SWITCH_ENABLED: 'false',
      MANUAL_EMAIL_SENDER: 'leadfinderbrasil@gmail.com',
      MANUAL_EMAIL_GOOGLE_CLIENT_ID: 'client-id',
      MANUAL_EMAIL_GOOGLE_CLIENT_SECRET: 'client-secret-000000',
      MANUAL_EMAIL_GOOGLE_REFRESH_TOKEN: 'refresh-token-000000',
      MANUAL_EMAIL_FINGERPRINT_KEY: 'fingerprint-key-000000000000000000000000000000',
      CAMPAIGN_DAILY_LIMIT_EMAIL: '6',
    } as const;
    expect(parseApiConfig(daily6)).toMatchObject({ DAILY6_PILOT_ENABLED: true, REAL_SEND_ENABLED: true });
    expect(() => parseApiConfig({ ...daily6, MANUAL_EMAIL_SENDER: 'other@example.com' })).toThrow('approved Lead Finder sender');
    expect(() => parseApiConfig({ ...daily6, HML_DAILY6_AUTH_ENABLED: 'false', HML_DAILY6_AUTH_TOKEN_HASH: undefined, HML_DAILY6_AUTH_EXPIRES_AT: undefined, HML_DAILY6_AUTH_PRINCIPAL_ID: undefined })).toThrow('HML_DAILY6_AUTH_ENABLED');
  });

  it('allows only the bounded HML supabase-render discovery worker contract', () => {
    const hmlOneShot = {
      ...database,
      DEPLOYMENT_PROFILE: 'supabase-render',
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      WORKER_MODE: 'oneshot',
      MAX_JOBS_PER_RUN: '1',
      COLLECTION_EGRESS_ENABLED: 'true',
      OVERPASS_API_URL: 'https://overpass-api.de/api/interpreter',
      ENRICHMENT_EGRESS_ENABLED: 'true',
      ENRICHMENT_PROVIDER: 'composite',
      TAVILY_API_KEY: 'synthetic-tavily-key',
      SHADOW_MODE_ENABLED: 'true',
      DRY_RUN: 'true',
      REAL_SEND_ENABLED: 'false',
      REAL_PROVIDERS_ENABLED: 'false',
    } as const;
    expect(parseWorkerConfig(hmlOneShot)).toMatchObject({
      DEPLOYMENT_PROFILE: 'supabase-render',
      WORKER_MODE: 'oneshot',
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      COLLECTION_EGRESS_ENABLED: true,
      ENRICHMENT_EGRESS_ENABLED: true,
    });
    expect(() => parseWorkerConfig({ ...hmlOneShot, WORKER_MODE: 'continuous' })).toThrow('bounded oneshot mode');
    expect(() => parseWorkerConfig({ ...hmlOneShot, DEPLOYMENT_ENVIRONMENT: 'production' })).toThrow('HML-only');
    expect(() => parseWorkerConfig({
      ...hmlOneShot,
      DEPLOYMENT_ENVIRONMENT: 'production',
      ENRICHMENT_EGRESS_ENABLED: 'true',
    })).toThrow('production');
    expect(() => parseWorkerConfig({ ...hmlOneShot, REAL_SEND_ENABLED: 'true' })).toThrow('DRY_RUN');
    expect(() => parseWorkerConfig({ ...hmlOneShot, REAL_PROVIDERS_ENABLED: 'true' })).toThrow('DRY_RUN');
    expect(() => parseWorkerConfig({ ...hmlOneShot, MAX_JOBS_PER_RUN: '2' })).toThrow('at most one job');
    expect(parseWorkerConfig({ ...database, DEPLOYMENT_PROFILE: 'oracle-vps' }).DEPLOYMENT_PROFILE).toBe('oracle-vps');
  });

  it('accepts Render PORT and validates an explicit CORS allowlist', () => {
    expect(parseApiConfig({ ...database, PORT: '10000' }).API_PORT).toBe(10000);
    expect(parseApiConfig({ ...database, CORS_ALLOWED_ORIGINS: 'https://app.example.test,https://fallback.example.test' }).CORS_ALLOWED_ORIGINS).toEqual([
      'https://app.example.test', 'https://fallback.example.test',
    ]);
    expect(() => parseApiConfig({ ...database, CORS_ALLOWED_ORIGINS: '*' })).toThrow('CORS_ALLOWED_ORIGINS');
  });
});
