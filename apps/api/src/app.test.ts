import { describe, expect, it, vi } from 'vitest';
import type { InjectOptions } from 'light-my-request';
import type { Database } from '@lead-finder/database';
import { changeCrmStage } from '@lead-finder/database';
import {
  buildApp,
  creationStatus,
  csvCell,
  safeCampaignAuditItem,
  safeCampaignFailureItem,
} from './app.js';

const sensitivePattern = /private@example\.test|\+5511999999999|tok_secret|postgresql:\/\/|select \* from|lead_contacts|stack-canary/i;
const testToken = 'synthetic-api-token-for-tests-only-0001';
const authenticatedApp = (db: Database) => buildApp(db, { authentication: { token: testToken } });
const authenticatedInject = (app: ReturnType<typeof buildApp>, options: InjectOptions) => app.inject({
  ...options,
  headers: { ...options.headers, authorization: `Bearer ${testToken}` },
});

describe('security-safe API output', () => {
  it('rejects concurrent collection requests before service or database access when egress is disabled', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; } });
    const enqueue = vi.fn();
    const app = buildApp(db, {
      collectionEgressEnabled: false,
      authentication: { token: testToken },
      enqueueCollection: enqueue,
    });
    let closed = false;
    try {
      const request = () => authenticatedInject(app, {
        method: 'POST',
        url: '/collect?endpoint=https://overpass.example.test',
        payload: { category: 'synthetic', city: 'Test', token: 'tok_secret' },
      });
      const responses = await Promise.all([request(), request()]);
      for (const response of responses) {
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({
          error: 'Collection is temporarily unavailable',
          code: 'COLLECTION_EGRESS_DISABLED',
        });
        expect(response.statusCode).not.toBe(202);
      }
      expect(enqueue).not.toHaveBeenCalled();
      expect(databaseAccesses).toBe(0);
      await app.close();
      closed = true;
      const logs = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(logs).toContain('COLLECTION_EGRESS_DISABLED');
      expect(logs).toContain('requestId');
      expect(logs).not.toMatch(/tok_secret|overpass\.example|stack|payload|endpoint/i);
    } finally {
      if (!closed) await app.close();
      stdout.mockRestore();
    }
  });

  it('preserves 202 and passes trusted authorization when egress is explicitly enabled', async () => {
    const enqueue = vi.fn().mockResolvedValue({ id: 'synthetic-job', status: 'PENDING' });
    const app = buildApp({} as Database, {
      collectionEgressEnabled: true,
      authentication: { token: testToken },
      enqueueCollection: enqueue,
    });
    const response = await authenticatedInject(app, {
      method: 'POST', url: '/collect', payload: { category: 'oficinas', city: 'Test' },
    });
    expect(response.statusCode).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      category: 'oficinas', city: 'Test',
    }), { enabled: true, configurationVersion: 1 });
    await app.close();
  });

  it('returns and logs a sanitized unexpected error', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const sensitive = 'private@example.test +5511999999999 tok_secret postgresql://u:p@db/x select * from lead_contacts stack-canary';
    const db = new Proxy({} as Database, { get: () => { throw new Error(sensitive); } });
    const app = authenticatedApp(db);
    let closed = false;
    try {
      const response = await authenticatedInject(app, { method: 'GET', url: '/leads?page=1&pageSize=20' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      await app.close();
      closed = true;
      const logs = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(logs).not.toMatch(sensitivePattern);
      expect(logs).toContain('request_failed');
    } finally {
      if (!closed) await app.close();
      stdout.mockRestore();
    }
  });

  it('preserves a safe client-error status for malformed JSON', async () => {
    const app = authenticatedApp({} as Database);
    const response = await authenticatedInject(app, {
      method: 'POST', url: '/collect', headers: { 'content-type': 'application/json' }, payload: '{',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid request', code: 'INVALID_REQUEST' });
    await app.close();
  });

  it('projects campaign audit rows without payload, idempotency, claim or lease internals', () => {
    const result = safeCampaignAuditItem({
      id: 'audit-id', aggregateType: 'CAMPAIGN', aggregateId: 'campaign-id', eventType: 'CREATED',
      status: 'PENDING', attempts: 1, maxAttemptsSnapshot: 5, availableAt: new Date('2030-01-01T00:00:00Z'),
      deadLetterCycle: 0, publishedAt: null, createdAt: new Date('2030-01-01T00:00:00Z'),
      payload: { email: 'private@example.test', message: 'stack-canary' }, idempotencyKey: 'tok_secret',
      payloadFingerprint: 'f'.repeat(64), claimWorkerId: 'worker', claimToken: 'token', claimGeneration: 3,
      claimedAt: new Date(), claimExpiresAt: new Date(),
    });
    expect(JSON.stringify(result)).not.toMatch(sensitivePattern);
    expect(result).toEqual(expect.objectContaining({ id: 'audit-id', aggregateId: 'campaign-id', eventType: 'CREATED' }));
    expect(result).not.toHaveProperty('payload');
    expect(result).not.toHaveProperty('claimToken');
  });

  it('projects campaign failures without raw payload, legacy error or claim metadata', () => {
    const result = safeCampaignFailureItem({
      id: 'failure-id', outboxId: 'outbox-id', cycle: 2, errorCode: 'SIMULATED_EXECUTION_FAILED',
      attempts: 5, createdAt: new Date('2030-01-01T00:00:00Z'), correlationId: 'secret-correlation',
      payload: { phone: '+5511999999999', email: 'private@example.test' },
      error: 'select * from lead_contacts stack-canary', claimGeneration: 7, claimToken: 'tok_secret',
    });
    expect(JSON.stringify(result)).not.toMatch(sensitivePattern);
    expect(result).toEqual(expect.objectContaining({ id: 'failure-id', outboxId: 'outbox-id', cycle: 2 }));
    expect(result).not.toHaveProperty('payload');
    expect(result).not.toHaveProperty('error');
  });
});

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
    const app = authenticatedApp(db);
    const response = await authenticatedInject(app, { method: 'PATCH', url: `/leads/${leadId}/crm/stage`, payload: { stage: 'GANHO' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'Invalid CRM stage change' });
    await app.close();
  });

  it('requires authentication and the dedicated reactivation permission before database access', async () => {
    let databaseAccesses = 0;
    const guardedDb = new Proxy({} as Database, { get: () => { databaseAccesses += 1; throw new Error('database accessed'); } });
    const payload = {
      actor: 'forged-client', expectedVersion: 3, idempotencyKey: 'reactivate-0001', stage: 'NOVO',
      action: 'REACTIVATE', reason: 'Synthetic reason', auditMetadata: { principalId: 'forged', timestamp: '2000-01-01T00:00:00Z' },
    };
    const anonymous = buildApp(guardedDb, { authentication: { token: testToken } });
    expect((await anonymous.inject({ method: 'PATCH', url: `/leads/${leadId}/crm/stage`, payload })).statusCode).toBe(401);
    await anonymous.close();

    const genericWriter = buildApp(guardedDb, { authentication: { token: testToken, principalPermissions: ['crm:write'] } });
    const forbidden = await authenticatedInject(genericWriter, {
      method: 'PATCH', url: `/leads/${leadId}/crm/stage?principalId=forged`, payload,
      headers: { 'x-user-id': 'forged', 'x-role': 'admin', 'x-permissions': 'crm:reactivate-do-not-contact' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: 'Access denied', code: 'FORBIDDEN' });
    expect(databaseAccesses).toBe(0);
    await genericWriter.close();
  });

  it('rejects direct service reactivation with missing or fabricated authorization context', async () => {
    const command = {
      expectedVersion: 3, idempotencyKey: 'reactivate-direct-0001', stage: 'NOVO' as const,
      action: 'REACTIVATE' as const, reason: 'Synthetic reason',
    };
    // @ts-expect-error Runtime defense is required even for untyped internal callers.
    await expect(changeCrmStage(db, leadId, command)).rejects.toMatchObject({ code: 'INVALID_REACTIVATION' });
    await expect(changeCrmStage(db, leadId, command, {
      principalId: 'forged', permissions: new Set(['crm:reactivate-do-not-contact']), authenticationMethod: 'forged',
    })).rejects.toMatchObject({ code: 'INVALID_REACTIVATION' });
  });

  it('requires a deterministic UTC boundary for overdue queues', async () => {
    const app = authenticatedApp(db);
    const missing = await authenticatedInject(app, { method: 'GET', url: '/crm/tasks/overdue' });
    const offset = await authenticatedInject(app, { method: 'GET', url: '/crm/tasks/overdue?to=2026-07-11T10:00:00-03:00' });
    expect(missing.statusCode).toBe(400);
    expect(offset.statusCode).toBe(400);
    await app.close();
  });

  it('bounds pagination and rejects unsupported query keys', async () => {
    const app = authenticatedApp(db);
    const tooLarge = await authenticatedInject(app, { method: 'GET', url: `/leads/${leadId}/notes?pageSize=101` });
    const unknown = await authenticatedInject(app, { method: 'GET', url: `/leads/${leadId}/tags?unexpected=true` });
    expect(tooLarge.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
    await app.close();
  });
});

describe('campaign management routes', () => {
  const db = {} as Database;
  const id = '20dfeb9d-30f0-4d5a-8762-3dbb4ed506aa';

  it('previews deterministically without database access and labels simulation explicitly', async () => {
    const app = authenticatedApp(db);
    const payload = { channel: 'EMAIL', content: 'Olá {{name}}', allowedVariables: ['name'], values: { name: 'Ana' } };
    const first = await authenticatedInject(app, { method: 'POST', url: '/campaigns/preview', payload });
    const second = await authenticatedInject(app, { method: 'POST', url: '/campaigns/preview', payload });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ mode: 'SIMULATION', channel: 'EMAIL', content: 'Olá Ana', dispatched: false });
    expect(second.body).toBe(first.body);
    await app.close();
  });

  it('requires HTTP idempotency for mutations before database access', async () => {
    const app = authenticatedApp(db);
    const creation = await authenticatedInject(app, { method: 'POST', url: '/campaigns', payload: { name: 'Test', channel: 'EMAIL', content: 'Hello', allowedVariables: [] } });
    const pause = await authenticatedInject(app, { method: 'POST', url: `/campaigns/${id}/pause`, payload: { actor: 'reviewer', expectedVersion: 1 } });
    expect(creation.statusCode).toBe(400); expect(creation.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(pause.statusCode).toBe(400); expect(pause.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    await app.close();
  });

  it('rejects malformed approvals, pagination and simulations deterministically', async () => {
    const app = authenticatedApp(db);
    const headers = { 'idempotency-key': 'test-key' };
    expect((await authenticatedInject(app, { method: 'POST', url: `/campaign-versions/${id}/approve`, headers, payload: { actor: ' ', approvedAt: 'invalid' } })).statusCode).toBe(400);
    expect((await authenticatedInject(app, { method: 'GET', url: '/campaigns/eligible/leads?channel=EMAIL&pageSize=101' })).statusCode).toBe(400);
    expect((await authenticatedInject(app, { method: 'POST', url: `/campaigns/${id}/simulations`, headers, payload: { campaignVersionId: id, channel: 'EMAIL', pageSize: 51 } })).statusCode).toBe(400);
    await app.close();
  });
});
