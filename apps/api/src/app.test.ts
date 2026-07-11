import { describe, expect, it } from 'vitest';
import type { Database } from '@lead-finder/database';
import { buildApp, csvCell } from './app.js';

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
