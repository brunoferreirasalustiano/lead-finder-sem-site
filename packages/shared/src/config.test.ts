import { describe, expect, it } from 'vitest';
import { parseApiConfig, parseWorkerConfig } from './config.js';

const database = { DATABASE_URL: 'postgresql://user:password@localhost:5432/database' };

describe('environment configuration', () => {
  it('applies safe defaults', () => {
    expect(parseApiConfig(database).API_PORT).toBe(3000);
    expect(parseWorkerConfig(database)).toMatchObject({
      OVERPASS_TIMEOUT_MS: 30000,
      OVERPASS_MAX_RETRIES: 3,
      WORKER_POLL_INTERVAL_MS: 60000,
      DAILY_LEAD_LIMIT: 50,
      OUTBOX_LEASE_MS: 30000,
    });
  });

  it.each([
    ['API_PORT', 'NaN'],
    ['API_PORT', '70000'],
    ['DAILY_LEAD_LIMIT', '-1'],
  ])('rejects invalid API variable %s=%s', (name, value) => {
    expect(() => parseApiConfig({ ...database, [name]: value })).toThrow(name);
  });

  it.each([
    ['OVERPASS_TIMEOUT_MS', '999'],
    ['OVERPASS_MAX_RETRIES', '-1'],
    ['OVERPASS_MAX_RETRIES', '11'],
    ['WORKER_POLL_INTERVAL_MS', 'NaN'],
    ['DAILY_LEAD_LIMIT', '0'],
    ['OUTBOX_LEASE_MS', '999'],
    ['OUTBOX_LEASE_MS', '3600001'],
  ])('rejects invalid worker variable %s=%s', (name, value) => {
    expect(() => parseWorkerConfig({ ...database, [name]: value })).toThrow(name);
  });
});
