import { describe, expect, it } from 'vitest';
import type { Database } from '@lead-finder/database';
import { buildApp, creationStatus, csvCell } from './app.js';

describe('csvCell', () => {
  it.each(['=SUM(1,1)', '+cmd', '-2+3', '@formula'])('neutralizes CSV formula %s', (value) =>
    expect(csvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`),
  );
  it('escapes commas, quotes and line breaks', () =>
    expect(csvCell('A,"B"\nC')).toBe('"A,""B""\nC"'));
  it('documents the export cell behavior without changing the 100-row API cap', () =>
    expect(csvCell(null)).toBe('""'));
});

describe('CRM routes', () => {
  const db = {} as Database;
  const leadId = '20dfeb9d-30f0-4d5a-8762-3dbb4ed506aa';

  it('uses 201 for a new creation and 200 for an idempotent replay', () => {
    expect(creationStatus(false)).toBe(201);
    expect(creationStatus(true)).toBe(200);
  });

  it('rejects malformed stage commands before accessing the database', async () => {
    const app = buildApp(db);
    const response = await app.inject({ method: 'PATCH', url: `/leads/${leadId}/crm/stage`, payload: { stage: 'GANHO' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'Invalid CRM stage change' });
    await app.close();
  });

  it('requires a deterministic UTC boundary for overdue queues', async () => {
    const app = buildApp(db);
    const missing = await app.inject({ method: 'GET', url: '/crm/tasks/overdue' });
    const offset = await app.inject({ method: 'GET', url: '/crm/tasks/overdue?to=2026-07-11T10:00:00-03:00' });
    expect(missing.statusCode).toBe(400);
    expect(offset.statusCode).toBe(400);
    await app.close();
  });

  it('bounds pagination and rejects unsupported query keys', async () => {
    const app = buildApp(db);
    const tooLarge = await app.inject({ method: 'GET', url: `/leads/${leadId}/notes?pageSize=101` });
    const unknown = await app.inject({ method: 'GET', url: `/leads/${leadId}/tags?unexpected=true` });
    expect(tooLarge.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
    await app.close();
  });
});

describe('campaign management routes', () => {
  const db = {} as Database;
  const id = '20dfeb9d-30f0-4d5a-8762-3dbb4ed506aa';

  it('previews deterministically without database access and labels simulation explicitly', async () => {
    const app = buildApp(db);
    const payload = { channel: 'EMAIL', content: 'Olá {{name}}', allowedVariables: ['name'], values: { name: 'Ana' } };
    const first = await app.inject({ method: 'POST', url: '/campaigns/preview', payload });
    const second = await app.inject({ method: 'POST', url: '/campaigns/preview', payload });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ mode: 'SIMULATION', channel: 'EMAIL', content: 'Olá Ana', dispatched: false });
    expect(second.body).toBe(first.body);
    await app.close();
  });

  it('requires HTTP idempotency for mutations before database access', async () => {
    const app = buildApp(db);
    const creation = await app.inject({ method: 'POST', url: '/campaigns', payload: { name: 'Test', channel: 'EMAIL', content: 'Hello', allowedVariables: [] } });
    const pause = await app.inject({ method: 'POST', url: `/campaigns/${id}/pause`, payload: { actor: 'reviewer', expectedVersion: 1 } });
    expect(creation.statusCode).toBe(400); expect(creation.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(pause.statusCode).toBe(400); expect(pause.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    await app.close();
  });

  it('rejects malformed approvals, pagination and simulations deterministically', async () => {
    const app = buildApp(db);
    const headers = { 'idempotency-key': 'test-key' };
    expect((await app.inject({ method: 'POST', url: `/campaign-versions/${id}/approve`, headers, payload: { actor: ' ', approvedAt: 'invalid' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/campaigns/eligible/leads?channel=EMAIL&pageSize=101' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/campaigns/${id}/simulations`, headers, payload: { campaignVersionId: id, channel: 'EMAIL', pageSize: 51 } })).statusCode).toBe(400);
    await app.close();
  });
});
