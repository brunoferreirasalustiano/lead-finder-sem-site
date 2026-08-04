import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { InjectOptions } from 'light-my-request';
import type { Database } from '@lead-finder/database';
import { changeCrmStage, ManualMessagingError } from '@lead-finder/database';
import {
  buildApp,
  creationStatus,
  csvCell,
  safeCampaignAuditItem,
  safeCampaignFailureItem,
} from './app.js';
import { permissions } from './auth.js';
import { findForbiddenPiiResponseKeys, safeLeadDto } from './api-contracts.js';

const sensitivePattern = /private@example\.test|\+5511999999999|tok_secret|postgresql:\/\/|select \* from|lead_contacts|stack-canary/i;
const testToken = 'synthetic-api-token-for-tests-only-0001';
const authenticatedApp = (db: Database) => buildApp(db, {
  authentication: { token: testToken, principalPermissions: permissions },
});
const authenticatedInject = (app: ReturnType<typeof buildApp>, options: InjectOptions) => app.inject({
  ...options,
  headers: { ...options.headers, authorization: `Bearer ${testToken}` },
});
const contractLeadId = '20dfeb9d-30f0-4d5a-8762-3dbb4ed506aa';
const contractCampaignId = '30dfeb9d-30f0-4d5a-8762-3dbb4ed506ab';
const contractVersionId = '40dfeb9d-30f0-4d5a-8762-3dbb4ed506ac';
const contractRecipientId = '50dfeb9d-30f0-4d5a-8762-3dbb4ed506ad';
const contractAttemptId = '60dfeb9d-30f0-4d5a-8762-3dbb4ed506ae';
const contractCanaries = [
  '+12025550100',
  '+12025550101',
  'private@example.test',
  'Rua Sintética 100',
  '-22.9000000',
  '-47.1000000',
] as const;
const contractSensitiveFields = {
  phone: contractCanaries[0],
  whatsapp: contractCanaries[1],
  email: contractCanaries[2],
  address: contractCanaries[3],
  latitude: contractCanaries[4],
  longitude: contractCanaries[5],
  originalValue: contractCanaries[0],
  normalizedValue: contractCanaries[2],
  recipientSnapshot: { contact: contractCanaries[0] },
  payloadSnapshot: { content: contractCanaries[2] },
};
const expectSerializedResponseWithoutPii = (body: string) => {
  const parsed = JSON.parse(body) as unknown;
  expect(findForbiddenPiiResponseKeys(parsed)).toEqual([]);
  for (const canary of contractCanaries) expect(body).not.toContain(canary);
};
type BuildOptions = NonNullable<Parameters<typeof buildApp>[1]>;
const contractApp = (overrides: NonNullable<BuildOptions['contractQueries']>) => buildApp({} as Database, {
  authentication: { token: testToken, principalPermissions: permissions },
  contractQueries: overrides,
});

describe('security-safe API output', () => {
  it('rejects concurrent collection requests before service or database access when egress is disabled', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; } });
    const enqueue = vi.fn();
    const app = buildApp(db, {
      collectionEgressEnabled: false,
      authentication: { token: testToken, principalPermissions: permissions },
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
      authentication: { token: testToken, principalPermissions: permissions },
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

describe('PII-minimized HTTP contracts', () => {
  const safeLead = {
    ...contractSensitiveFields,
    id: contractLeadId,
    name: 'Empresa Sintética',
    category: 'servicos',
    city: 'Cidade',
    state: 'ST',
    website: 'https://example.test',
    score: 80,
    status: 'SEM_SITE_CADASTRADO',
    qualificationStatus: 'SEM_SITE_CONFIRMADO',
    isBlocked: false,
    doNotContact: false,
    isClosed: false,
    crmStage: 'NOVO',
    crmPriority: 'MEDIA',
    crmOwner: null,
    crmNextActionAt: null,
    crmVersion: 1,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
  };
  const contact = {
    ...contractSensitiveFields,
    id: contractRecipientId,
    leadId: contractLeadId,
    type: 'EMAIL',
    source: 'SYNTHETIC_TEST',
    confidence: '1.000',
    verifiedAt: new Date('2030-01-01T00:00:00.000Z'),
    isValid: true,
    possibleWhatsapp: false,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
  };

  it('preserves lead list status, pagination and database ordering without PII', async () => {
    const app = contractApp({
      listLeads: vi.fn().mockResolvedValue({
        items: [safeLead, { ...safeLead, id: contractCampaignId, score: 70 }],
        pagination: { page: 2, pageSize: 2, total: 4, totalPages: 2 },
      }) as never,
    });
    const response = await authenticatedInject(app, { method: 'GET', url: '/leads?page=2&pageSize=2' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: contractLeadId }, { id: contractCampaignId }],
      pagination: { page: 2, pageSize: 2, total: 4, totalPages: 2 },
    });
    expectSerializedResponseWithoutPii(response.body);
    await app.close();
  });

  it('preserves lead detail success, not-found code and authentication', async () => {
    const getLead = vi.fn().mockResolvedValueOnce(safeLead).mockResolvedValueOnce(null);
    const app = contractApp({ getLead: getLead as never });
    const ok = await authenticatedInject(app, { method: 'GET', url: `/leads/${contractLeadId}` });
    const missing = await authenticatedInject(app, { method: 'GET', url: `/leads/${contractCampaignId}` });
    const anonymous = await app.inject({ method: 'GET', url: `/leads/${contractLeadId}` });
    expect(ok.statusCode).toBe(200);
    expect(missing.statusCode).toBe(404);
    expect(anonymous.statusCode).toBe(401);
    expectSerializedResponseWithoutPii(ok.body);
    await app.close();
  });

  it('keeps contact normalization persistence internal for GET and PUT responses', async () => {
    const app = contractApp({
      getQualification: vi.fn().mockResolvedValue({ id: contractLeadId, outreachEligible: true }) as never,
      listContacts: vi.fn().mockResolvedValue([contact]) as never,
      upsertContact: vi.fn().mockResolvedValue(contact) as never,
    });
    const listed = await authenticatedInject(app, { method: 'GET', url: `/leads/${contractLeadId}/contacts` });
    const updated = await authenticatedInject(app, {
      method: 'PUT',
      url: `/leads/${contractLeadId}/contacts`,
      payload: {
        type: 'EMAIL',
        value: contractCanaries[2],
        source: 'SYNTHETIC_TEST',
        actor: 'contract-test',
        confidence: 1,
        isValid: true,
        possibleWhatsapp: false,
      },
    });
    expect(listed.statusCode).toBe(200);
    expect(updated.statusCode).toBe(200);
    expectSerializedResponseWithoutPii(listed.body);
    expectSerializedResponseWithoutPii(updated.body);
    await app.close();
  });

  it('returns history and CRM audit metadata without persisted JSONB or free text', async () => {
    const app = contractApp({
      getQualification: vi.fn().mockResolvedValue({ id: contractLeadId, outreachEligible: true }) as never,
      listHistory: vi.fn().mockResolvedValue([{
        id: 'history-id',
        leadId: contractLeadId,
        eventType: 'CONTACT_UPDATED',
        actor: 'operator-id',
        source: 'SYNTHETIC_TEST',
        reason: contractCanaries[2],
        previousValue: contractSensitiveFields,
        newValue: contractSensitiveFields,
        createdAt: new Date('2030-01-01T00:00:00.000Z'),
      }]) as never,
      getCrm: vi.fn().mockResolvedValue({
        lead: safeLead,
        opportunities: [{
          id: 'opportunity-id',
          leadId: contractLeadId,
          title: contractCanaries[2],
          amount: null,
          currency: 'BRL',
          expectedCloseAt: null,
          closedAt: null,
          outcome: null,
          version: 1,
          createdAt: new Date('2030-01-01T00:00:00.000Z'),
          updatedAt: new Date('2030-01-01T00:00:00.000Z'),
        }],
        notes: [{
          id: 'note-id',
          leadId: contractLeadId,
          body: contractCanaries[3],
          createdAt: new Date('2030-01-01T00:00:00.000Z'),
        }],
        tags: [{
          id: 'tag-id',
          name: contractCanaries[2],
          createdAt: new Date('2030-01-01T00:00:00.000Z'),
        }],
        tasks: [{
          id: 'task-id',
          leadId: contractLeadId,
          title: contractCanaries[0],
          status: 'PENDENTE',
          priority: 'MEDIA',
          dueAt: new Date('2030-01-02T00:00:00.000Z'),
          completedAt: null,
          version: 1,
          createdAt: new Date('2030-01-01T00:00:00.000Z'),
          updatedAt: new Date('2030-01-01T00:00:00.000Z'),
        }],
      }) as never,
    });
    const history = await authenticatedInject(app, { method: 'GET', url: `/leads/${contractLeadId}/history` });
    const crm = await authenticatedInject(app, { method: 'GET', url: `/leads/${contractLeadId}/crm` });
    expect(history.statusCode).toBe(200);
    expect(crm.statusCode).toBe(200);
    expectSerializedResponseWithoutPii(history.body);
    expectSerializedResponseWithoutPii(crm.body);
    await app.close();
  });

  it('sanitizes qualification evidence lists and evidence creation responses', async () => {
    const evidence = {
      id: 'evidence-id',
      leadId: contractLeadId,
      source: 'SYNTHETIC_TEST',
      confidence: '1.000',
      observedAt: new Date('2030-01-01T00:00:00.000Z'),
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
      reference: `${contractCanaries[0]} ${contractCanaries[5]}`,
      result: contractCanaries[2],
      notes: `${contractCanaries[3]} ${contractCanaries[4]}`,
      fingerprint: contractCanaries[1],
    };
    const app = contractApp({
      getQualification: vi.fn().mockResolvedValue({
        id: contractLeadId,
        qualificationStatus: 'SEM_SITE_CONFIRMADO',
        isBlocked: false,
        doNotContact: false,
        outreachEligible: true,
      }) as never,
      listEvidence: vi.fn().mockResolvedValue([evidence]) as never,
      addEvidence: vi.fn().mockResolvedValue(evidence) as never,
    });
    const qualification = await authenticatedInject(app, {
      method: 'GET',
      url: `/leads/${contractLeadId}/qualification`,
    });
    const created = await authenticatedInject(app, {
      method: 'POST',
      url: `/leads/${contractLeadId}/evidence`,
      payload: {
        actor: 'contract-test',
        source: 'SYNTHETIC_TEST',
        reference: `${contractCanaries[0]} ${contractCanaries[5]}`,
        result: contractCanaries[2],
        confidence: 1,
        observedAt: '2030-01-01T00:00:00.000Z',
        notes: `${contractCanaries[3]} ${contractCanaries[4]}`,
      },
    });
    expect(qualification.statusCode).toBe(200);
    expect(created.statusCode).toBe(201);
    expect(qualification.json()).toMatchObject({
      evidence: [{
        id: 'evidence-id',
        leadId: contractLeadId,
        source: 'SYNTHETIC_TEST',
        confidence: '1.000',
      }],
    });
    for (const response of [qualification, created]) expectSerializedResponseWithoutPii(response.body);
    await app.close();
  });

  it('sanitizes timeline events while preserving pagination and authorization', async () => {
    const listTimelineMock = vi.fn().mockResolvedValue([{
      id: 'timeline-id',
      leadId: contractLeadId,
      opportunityId: null,
      taskId: null,
      eventType: 'ASSIGNMENT_UPDATED',
      actor: 'operator-id',
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
      reason: contractCanaries[2],
      previousValue: { ...contractSensitiveFields },
      newValue: { ...contractSensitiveFields },
      metadata: { nested: contractSensitiveFields },
    }]);
    const app = contractApp({ listTimeline: listTimelineMock as never });
    const response = await authenticatedInject(app, {
      method: 'GET',
      url: `/leads/${contractLeadId}/timeline?page=2&pageSize=2`,
    });
    const anonymous = await app.inject({
      method: 'GET',
      url: `/leads/${contractLeadId}/timeline?page=2&pageSize=2`,
    });
    expect(response.statusCode).toBe(200);
    expect(anonymous.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      items: [{ id: 'timeline-id', eventType: 'ASSIGNMENT_UPDATED' }],
      pagination: { page: 2, pageSize: 2, hasMore: false },
    });
    expect(listTimelineMock).toHaveBeenCalledWith(expect.anything(), contractLeadId, {
      limit: 2,
      offset: 2,
    });
    expectSerializedResponseWithoutPii(response.body);
    await app.close();
  });

  it('sanitizes overdue and upcoming CRM queues and preserves bounds', async () => {
    const queueItem = {
      task: {
        id: 'task-id',
        leadId: contractLeadId,
        opportunityId: null,
        title: contractCanaries[0],
        description: contractCanaries[2],
        completionNote: contractCanaries[3],
        owner: contractCanaries[1],
        status: 'PENDENTE',
        priority: 'ALTA',
        dueAt: new Date('2030-01-02T00:00:00.000Z'),
        completedAt: null,
        version: 2,
        createdAt: new Date('2030-01-01T00:00:00.000Z'),
        updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      },
      lead: safeLead,
    };
    const overdue = vi.fn().mockResolvedValue([queueItem]);
    const upcoming = vi.fn().mockResolvedValue([queueItem]);
    const app = contractApp({
      listOverdueTasks: overdue as never,
      listUpcomingFollowUps: upcoming as never,
    });
    const overdueResponse = await authenticatedInject(app, {
      method: 'GET',
      url: '/crm/tasks/overdue?to=2030-01-02T00:00:00.000Z&pageSize=2',
    });
    const upcomingResponse = await authenticatedInject(app, {
      method: 'GET',
      url: '/crm/follow-ups/upcoming?from=2030-01-01T00:00:00.000Z&to=2030-01-03T00:00:00.000Z&pageSize=2&owner=operator-id',
    });
    expect(overdueResponse.statusCode).toBe(200);
    expect(upcomingResponse.statusCode).toBe(200);
    expect(overdue).toHaveBeenCalledWith(expect.anything(), new Date('2030-01-02T00:00:00.000Z'), 2);
    expect(upcoming).toHaveBeenCalledWith(
      expect.anything(),
      new Date('2030-01-01T00:00:00.000Z'),
      new Date('2030-01-03T00:00:00.000Z'),
      2,
      'operator-id',
    );
    const expectedLead = JSON.parse(JSON.stringify(safeLeadDto(safeLead))) as unknown;
    for (const response of [overdueResponse, upcomingResponse]) {
      const body = JSON.parse(response.body) as unknown;
      expect(body).toEqual([{
        task: {
          id: 'task-id',
          leadId: contractLeadId,
          opportunityId: null,
          status: 'PENDENTE',
          priority: 'ALTA',
          dueAt: '2030-01-02T00:00:00.000Z',
          completedAt: null,
          version: 2,
          createdAt: '2030-01-01T00:00:00.000Z',
          updatedAt: '2030-01-01T00:00:00.000Z',
        },
        lead: expectedLead,
      }]);
      expectSerializedResponseWithoutPii(response.body);
    }
    await app.close();
  });

  it('sanitizes campaign eligibility, recipient and attempt list responses', async () => {
    const app = contractApp({
      listEligibleCampaignLeads: vi.fn().mockResolvedValue([{ lead: safeLead, contact }]) as never,
      listCampaignRecipients: vi.fn().mockResolvedValue([{
        ...contractSensitiveFields,
        id: contractRecipientId,
        campaignId: contractCampaignId,
        campaignVersionId: contractVersionId,
        leadId: contractLeadId,
        channel: 'EMAIL',
        state: 'PENDENTE',
        version: 1,
      }]) as never,
      listRecipientAttempts: vi.fn().mockResolvedValue([{
        ...contractSensitiveFields,
        id: contractAttemptId,
        recipientId: contractRecipientId,
        state: 'PENDENTE',
        version: 1,
      }]) as never,
    });
    const eligible = await authenticatedInject(app, {
      method: 'GET',
      url: '/campaigns/eligible/leads?channel=EMAIL&page=1&pageSize=20',
    });
    const recipients = await authenticatedInject(app, {
      method: 'GET',
      url: `/campaigns/${contractCampaignId}/recipients?page=1&pageSize=20`,
    });
    const attempts = await authenticatedInject(app, {
      method: 'GET',
      url: `/recipients/${contractRecipientId}/attempts?page=1&pageSize=20`,
    });
    for (const response of [eligible, recipients, attempts]) {
      expect(response.statusCode).toBe(200);
      expectSerializedResponseWithoutPii(response.body);
    }
    await app.close();
  });

  it('preserves simulation mode, no-dispatch and idempotency without returning content', async () => {
    const reserve = vi.fn().mockResolvedValue({
      data: {
        ...contractSensitiveFields,
        id: contractRecipientId,
        campaignId: contractCampaignId,
        campaignVersionId: contractVersionId,
        leadId: contractLeadId,
        channel: 'EMAIL',
        state: 'PENDENTE',
        version: 1,
      },
      replayed: false,
    });
    const createAttempt = vi.fn().mockResolvedValue({
      data: {
        ...contractSensitiveFields,
        id: contractAttemptId,
        recipientId: contractRecipientId,
        state: 'PENDENTE',
        version: 1,
      },
      replayed: false,
    });
    const app = contractApp({
      listCampaignTemplates: vi.fn().mockResolvedValue([{
        id: 'template-id',
        campaignVersionId: contractVersionId,
        channel: 'EMAIL',
        content: 'Contato {{contact}}',
        allowedVariables: ['contact'],
      }]) as never,
      listEligibleCampaignLeads: vi.fn().mockResolvedValue([{ lead: safeLead, contact }]) as never,
      reserveSimulatedRecipient: reserve as never,
      createAttemptWithOutbox: createAttempt as never,
    });
    const request: InjectOptions = {
      method: 'POST',
      url: `/campaigns/${contractCampaignId}/simulations`,
      headers: { 'idempotency-key': 'simulation-contract-key' },
      payload: { campaignVersionId: contractVersionId, channel: 'EMAIL', page: 1, pageSize: 20 },
    };
    const response = await authenticatedInject(app, request);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: 'SIMULATION', dispatched: false });
    expect(reserve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: `simulation-contract-key:${contractLeadId}`,
    }));
    expect(createAttempt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: `simulation-contract-key:${contractLeadId}:attempt`,
    }));
    expectSerializedResponseWithoutPii(response.body);
    await app.close();
  });

  it('exports only the safe lead projection while preserving CSV escaping and the 100-row cap', async () => {
    const listLeadsMock = vi.fn().mockResolvedValue({
      items: [{ ...safeLead, name: '=Empresa,"Sintética"\nTeste' }],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    const app = contractApp({ listLeads: listLeadsMock as never });
    const response = await authenticatedInject(app, { method: 'GET', url: '/leads/export.csv' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body).toContain(`"'=Empresa,""Sintética""\nTeste"`);
    expect(listLeadsMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      page: 1,
      pageSize: 100,
    }));
    for (const forbidden of ['phone', 'whatsapp', 'email', 'address', 'latitude', 'longitude']) {
      expect(response.body.toLowerCase()).not.toContain(forbidden);
    }
    for (const canary of contractCanaries) expect(response.body).not.toContain(canary);
    await app.close();
  });
});

describe('WhatsApp Cloud HML delivery route', () => {
  const preparationId = '123e4567-e89b-42d3-a456-426614174000';
  const operatorToken = 'synthetic-hml-cloud-operator-token-for-tests-000000000000';
  const runtime = {
    enabled: true,
    realSendEnabled: true,
    deploymentEnvironment: 'homologation' as const,
    phoneNumberId: '123456789012345',
    wabaId: '987654321098765',
    accessToken: 'synthetic-cloud-access-token-012345678901234567890123',
    testRecipient: '+5519971519337',
    maxSends: 1,
  };

  it('reads the fixed scope before returning Cloud API disabled', async () => {
    const readScope = vi.fn().mockResolvedValue('AVAILABLE');
    const app = buildApp({} as Database, {
      authentication: {
        token: testToken,
        principalPermissions: [],
        operatorTemporary: {
          tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-internal-whatsapp-operator',
          principalPermissions: ['manual-messaging:cloud-send'],
          environment: 'homologation',
        },
      },
      whatsappCloudRuntime: { ...runtime, enabled: false },
      deliverWhatsAppCloud: vi.fn(),
      getWhatsappCloudSendScopeStatus: readScope,
    });
    const response = await app.inject({
      method: 'POST',
      url: `/manual-message-preparations/${preparationId}/whatsapp-cloud-send`,
      headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': 'synthetic-cloud-disabled-1' },
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service unavailable', code: 'WHATSAPP_CLOUD_DISABLED' });
    expect(readScope).toHaveBeenCalledWith(expect.anything(), 'HML_TEST_002');
    await app.close();
  });

  it('returns a non-retryable 409 for a consumed scope while Cloud API is disabled', async () => {
    const readScope = vi.fn().mockResolvedValue('CONSUMED');
    const deliver = vi.fn();
    const app = buildApp({} as Database, {
      authentication: {
        token: testToken,
        principalPermissions: [],
        operatorTemporary: {
          tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-internal-whatsapp-operator',
          principalPermissions: ['manual-messaging:cloud-send'],
          environment: 'homologation',
        },
      },
      whatsappCloudRuntime: { ...runtime, enabled: false, realSendEnabled: false },
      deliverWhatsAppCloud: deliver,
      getWhatsappCloudSendScopeStatus: readScope,
    });
    const response = await app.inject({
      method: 'POST',
      url: `/manual-message-preparations/${preparationId}/whatsapp-cloud-send`,
      headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': 'synthetic-cloud-consumed-preflight-1' },
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'WhatsApp test scope already consumed',
      code: 'WHATSAPP_TEST_SCOPE_CONSUMED',
      retryAllowed: false,
    });
    expect(deliver).not.toHaveBeenCalled();
    await app.close();
  });

  it('blocks production before reading scope state', async () => {
    const readScope = vi.fn();
    const app = buildApp({} as Database, {
      authentication: {
        token: testToken,
        principalPermissions: [],
        operatorTemporary: {
          tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-internal-whatsapp-operator',
          principalPermissions: ['manual-messaging:cloud-send'],
          environment: 'homologation',
        },
      },
      whatsappCloudRuntime: { ...runtime, deploymentEnvironment: 'production' },
      getWhatsappCloudSendScopeStatus: readScope,
    });
    const response = await app.inject({
      method: 'POST',
      url: `/manual-message-preparations/${preparationId}/whatsapp-cloud-send`,
      headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': 'synthetic-cloud-production-1' },
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(readScope).not.toHaveBeenCalled();
    await app.close();
  });

  it('requires the HML operator principal and returns only sanitized provider metadata', async () => {
    const sendPrepared = vi.fn().mockResolvedValue({
      attemptId: '70dfeb9d-30f0-4d5a-8762-3dbb4ed506af',
      state: 'ACCEPTED',
      provider: 'WHATSAPP_CLOUD_API',
      providerMessageFingerprint: 'a'.repeat(64),
      reservedAt: new Date('2026-08-02T12:00:00.000Z'),
      replayed: false,
    });
    const app = buildApp({} as Database, {
      authentication: {
        token: testToken,
        principalPermissions: [],
        operatorTemporary: {
          tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-internal-whatsapp-operator',
          principalPermissions: ['manual-messaging:cloud-send'],
          environment: 'homologation',
        },
      },
      whatsappCloudRuntime: runtime,
      deliverWhatsAppCloud: vi.fn(),
      sendPreparedWhatsAppCloud: sendPrepared,
      getWhatsappCloudSendScopeStatus: vi.fn().mockResolvedValue('AVAILABLE'),
    });
    const denied = await authenticatedInject(app, {
      method: 'POST',
      url: `/manual-message-preparations/${preparationId}/whatsapp-cloud-send`,
      headers: { 'idempotency-key': 'synthetic-cloud-main-1' },
      payload: {},
    });
    expect(denied.statusCode).toBe(403);

    const accepted = await app.inject({
      method: 'POST',
      url: `/manual-message-preparations/${preparationId}/whatsapp-cloud-send`,
      headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': 'synthetic-cloud-operator-1' },
      payload: {},
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toEqual({
      state: 'ACCEPTED', provider: 'WHATSAPP_CLOUD_API', replayed: false,
      attemptId: '70dfeb9d-30f0-4d5a-8762-3dbb4ed506af', providerMessageFingerprint: 'a'.repeat(64),
    });
    expect(accepted.body).not.toContain(runtime.accessToken);
    expect(accepted.body).not.toContain(runtime.testRecipient);
    expect(sendPrepared).toHaveBeenCalledWith(
      expect.anything(), preparationId, expect.objectContaining({ principalId: 'hml-internal-whatsapp-operator' }), runtime, expect.anything(), 'synthetic-cloud-operator-1',
    );
    await app.close();
  });

  it('returns a non-retryable 409 when the consumed scope domain error is raised', async () => {
    const app = buildApp({} as Database, {
      authentication: {
        token: testToken,
        principalPermissions: [],
        operatorTemporary: {
          tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-internal-whatsapp-operator',
          principalPermissions: ['manual-messaging:cloud-send'],
          environment: 'homologation',
        },
      },
      whatsappCloudRuntime: runtime,
      deliverWhatsAppCloud: vi.fn(),
      sendPreparedWhatsAppCloud: vi.fn().mockRejectedValue(new ManualMessagingError(
        'WhatsApp Cloud test scope has already been consumed',
        'WHATSAPP_TEST_SCOPE_CONSUMED',
      )),
      getWhatsappCloudSendScopeStatus: vi.fn().mockResolvedValue('AVAILABLE'),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/manual-message-preparations/${preparationId}/whatsapp-cloud-send`,
      headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': 'synthetic-cloud-consumed-1' },
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'WhatsApp test scope already consumed',
      code: 'WHATSAPP_TEST_SCOPE_CONSUMED',
      retryAllowed: false,
    });
    expect(response.body).not.toMatch(/23505|constraint|table|stack|token|wa\.me/i);
    await app.close();
  });

  it('keeps unrelated unique violations as sanitized 500 errors', async () => {
    const unrelated = Object.assign(new Error('database detail'), {
      code: '23505',
      constraint: 'unrelated_unique_constraint',
    });
    const app = buildApp({} as Database, {
      authentication: {
        token: testToken,
        principalPermissions: [],
        operatorTemporary: {
          tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-internal-whatsapp-operator',
          principalPermissions: ['manual-messaging:cloud-send'],
          environment: 'homologation',
        },
      },
      whatsappCloudRuntime: runtime,
      deliverWhatsAppCloud: vi.fn(),
      sendPreparedWhatsAppCloud: vi.fn().mockRejectedValue(unrelated),
      getWhatsappCloudSendScopeStatus: vi.fn().mockResolvedValue('AVAILABLE'),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/manual-message-preparations/${preparationId}/whatsapp-cloud-send`,
      headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': 'synthetic-cloud-unrelated-1' },
      payload: {},
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(response.body).not.toMatch(/23505|unrelated_unique_constraint|database detail|stack|token|wa\.me/i);
    await app.close();
  });
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
    const anonymous = buildApp(guardedDb, {
      authentication: { token: testToken, principalPermissions: permissions },
    });
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
