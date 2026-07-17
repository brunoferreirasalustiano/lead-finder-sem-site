import { describe, expect, it } from 'vitest';
import type { Database } from '@lead-finder/database';
import { buildApp } from './app.js';

const token = 'synthetic-pilot-api-token-for-tests-0001';
const headers = { authorization: `Bearer ${token}` };

describe('controlled pilot API boundary', () => {
  it('keeps pilot routes authenticated and non-public before database access', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; throw new Error('database accessed'); } });
    const app = buildApp(db, { authentication: { token } });
    const response = await app.inject({ method: 'GET', url: '/pilots' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
    expect(databaseAccesses).toBe(0);
    await app.close();
  });

  it('requires pilot-specific permission instead of crm:write', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; throw new Error('database accessed'); } });
    const app = buildApp(db, { authentication: { token, principalPermissions: ['crm:write'] } });
    const response = await app.inject({ method: 'POST', url: '/pilots', headers,
      payload: { name: 'Piloto Sintetico', region: 'Regiao Ficticia', category: 'Categoria Ficticia', targetLeadCount: 20 } });
    expect(response.statusCode).toBe(403);
    expect(databaseAccesses).toBe(0);
    await app.close();
  });

  it('rejects forged audit identity and timestamp fields before database access', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; throw new Error('database accessed'); } });
    const app = buildApp(db, { authentication: { token, principalPermissions: ['pilot:write'] } });
    const response = await app.inject({ method: 'POST', url: '/pilots', headers: { ...headers, 'idempotency-key': 'pilot-create-0001' },
      payload: { name: 'Piloto Sintetico', region: 'Regiao Ficticia', category: 'Categoria Ficticia', targetLeadCount: 20,
        actor: 'attacker', principalId: 'attacker', timestamp: '2026-01-01T00:00:00Z' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid pilot request', code: 'INVALID_REQUEST' });
    expect(databaseAccesses).toBe(0);
    await app.close();
  });

  it('rejects divergent header and body idempotency keys before database access', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; throw new Error('database accessed'); } });
    const app = buildApp(db, { authentication: { token, principalPermissions: ['pilot:record-result'] } });
    const response = await app.inject({ method: 'POST', url: `/pilots/123e4567-e89b-42d3-a456-426614174000/leads/123e4567-e89b-42d3-a456-426614174001/results`,
      headers: { ...headers, 'idempotency-key': 'header-key-0001' },
      payload: { result: 'NOT_CONTACTED', expectedVersion: 0, idempotencyKey: 'body-key-000001' } });
    expect(response.statusCode).toBe(400);
    expect(databaseAccesses).toBe(0);
    await app.close();
  });
});
