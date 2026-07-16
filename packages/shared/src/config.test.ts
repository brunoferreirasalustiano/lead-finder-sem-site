import { describe, expect, it } from 'vitest';
import { parseApiConfig, parseWorkerConfig } from './config.js';

const database = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
  API_AUTH_TOKEN: 'synthetic-api-token-for-tests-only-0001',
};

describe('environment configuration', () => {
  it('applies safe defaults', () => {
    expect(parseApiConfig(database).API_PORT).toBe(3000);
    expect(parseWorkerConfig(database)).toMatchObject({
      COLLECTION_EGRESS_ENABLED: false,
      OVERPASS_TIMEOUT_MS: 30000,
      OVERPASS_MAX_RETRIES: 3,
      WORKER_POLL_INTERVAL_MS: 60000,
      DAILY_LEAD_LIMIT: 50,
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
    });
    expect(parseWorkerConfig(database).OVERPASS_API_URL).toBeUndefined();
    expect(parseWorkerConfig({ ...database, OVERPASS_API_URL: '' }).OVERPASS_API_URL).toBeUndefined();
  });

  it.each([
    ['API_PORT', 'NaN'],
    ['API_PORT', '70000'],
    ['DAILY_LEAD_LIMIT', '-1'],
  ])('rejects invalid API variable %s=%s', (name, value) => {
    expect(() => parseApiConfig({ ...database, [name]: value })).toThrow(name);
  });

  it.each([undefined, '', 'too-short', 'CHANGE_ME'])('rejects an unsafe API token %s', (value) => {
    expect(() => parseApiConfig({ ...database, API_AUTH_TOKEN: value })).toThrow('API_AUTH_TOKEN');
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
    expect(parseWorkerConfig({ ...database, SHADOW_MODE_ENABLED: 'true' })).toMatchObject({
      SHADOW_MODE_ENABLED: true,
      COLLECTION_EGRESS_ENABLED: false,
    });
    expect(parseWorkerConfig({ ...database, SHADOW_MODE_ENABLED: 'false' }).SHADOW_MODE_ENABLED).toBe(false);
    expect(() => parseWorkerConfig({ ...database, SHADOW_MODE_ENABLED: 'yes' })).toThrow('SHADOW_MODE_ENABLED');
  });

  it('requires an explicit Overpass URL only when collection egress is enabled', () => {
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
});
