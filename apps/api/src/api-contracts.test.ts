import { describe, expect, it } from 'vitest';
import {
  findForbiddenPiiResponseKeys,
  safeCampaignAttemptDto,
  safeCampaignRecipientDto,
  safeCampaignSimulationDto,
  safeContactDto,
  safeCrmQueueItemDto,
  safeCrmTimelineDto,
  safeCrmDto,
  safeEvidenceDto,
  safeEligibleCampaignLeadDto,
  safeHistoryDto,
  safeLeadDto,
} from './api-contracts.js';

const piiCanaries = [
  '+12025550100',
  '+12025550101',
  'private@example.test',
  'Rua Sintética 100',
  '-22.9000000',
  '-47.1000000',
] as const;

const sensitive = {
  phone: piiCanaries[0],
  whatsapp: piiCanaries[1],
  email: piiCanaries[2],
  address: piiCanaries[3],
  latitude: piiCanaries[4],
  longitude: piiCanaries[5],
  originalValue: piiCanaries[0],
  normalizedValue: piiCanaries[1],
  recipientSnapshot: { contact: piiCanaries[0] },
  payloadSnapshot: { content: piiCanaries[2] },
};

const expectNoPii = (value: unknown) => {
  expect(findForbiddenPiiResponseKeys(value)).toEqual([]);
  const serialized = JSON.stringify(value);
  for (const canary of piiCanaries) expect(serialized).not.toContain(canary);
};

describe('safe PII HTTP contracts', () => {
  it('projects lead list and detail fields with an explicit allowlist', () => {
    const result = safeLeadDto({
      ...sensitive,
      id: 'lead-id',
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
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
    });
    expect(result).toMatchObject({ id: 'lead-id', category: 'servicos', crmVersion: 1 });
    expectNoPii(result);
  });

  it('returns only contact metadata for reads and upsert responses', () => {
    const result = safeContactDto({
      ...sensitive,
      id: 'contact-id',
      leadId: 'lead-id',
      type: 'TELEFONE',
      source: 'SYNTHETIC_TEST',
      confidence: '1.000',
      verifiedAt: '2030-01-01T00:00:00.000Z',
      isValid: true,
      possibleWhatsapp: true,
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
    });
    expect(result).toMatchObject({ id: 'contact-id', leadId: 'lead-id', isValid: true });
    expectNoPii(result);
  });

  it('does not expose nested history values or free-text reasons', () => {
    const result = safeHistoryDto({
      ...sensitive,
      id: 'history-id',
      leadId: 'lead-id',
      eventType: 'CONTACT_UPDATED',
      actor: 'operator-id',
      source: 'SYNTHETIC_TEST',
      reason: piiCanaries[2],
      previousValue: { nested: sensitive },
      newValue: { nested: sensitive },
      createdAt: '2030-01-01T00:00:00.000Z',
    });
    expect(result).toEqual({
      id: 'history-id',
      leadId: 'lead-id',
      eventType: 'CONTACT_UPDATED',
      actor: 'operator-id',
      source: 'SYNTHETIC_TEST',
      createdAt: '2030-01-01T00:00:00.000Z',
    });
    expectNoPii(result);
  });

  it('projects CRM aggregates without raw lead or free-text content', () => {
    const result = safeCrmDto({
      lead: { ...sensitive, id: 'lead-id', name: 'Empresa Sintética' },
      opportunities: [{
        id: 'opportunity-id',
        leadId: 'lead-id',
        title: piiCanaries[2],
        amount: '100.00',
        currency: 'BRL',
        expectedCloseAt: null,
        closedAt: '2030-01-02T00:00:00.000Z',
        outcome: 'GANHO',
        version: 3,
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-02T00:00:00.000Z',
      }],
      notes: [{
        id: 'note-id',
        leadId: 'lead-id',
        body: piiCanaries[3],
        createdAt: '2030-01-01T00:00:00.000Z',
      }],
      tags: [{
        id: 'tag-id',
        name: piiCanaries[2],
        createdAt: '2030-01-01T00:00:00.000Z',
      }],
      tasks: [{
        id: 'task-id',
        leadId: 'lead-id',
        opportunityId: null,
        title: piiCanaries[0],
        status: 'PENDENTE',
        priority: 'ALTA',
        dueAt: '2030-01-03T00:00:00.000Z',
        completedAt: null,
        version: 4,
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-02T00:00:00.000Z',
      }],
    });
    expect(result).toEqual({
      lead: safeLeadDto({ id: 'lead-id', name: 'Empresa Sintética' }),
      opportunities: [{
        id: 'opportunity-id',
        leadId: 'lead-id',
        amount: '100.00',
        currency: 'BRL',
        expectedCloseAt: null,
        closedAt: '2030-01-02T00:00:00.000Z',
        outcome: 'GANHO',
        version: 3,
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-02T00:00:00.000Z',
      }],
      notes: [{
        id: 'note-id',
        leadId: 'lead-id',
        opportunityId: null,
        createdAt: '2030-01-01T00:00:00.000Z',
      }],
      tags: [{ id: 'tag-id', createdAt: '2030-01-01T00:00:00.000Z' }],
      tasks: [{
        id: 'task-id',
        leadId: 'lead-id',
        opportunityId: null,
        status: 'PENDENTE',
        priority: 'ALTA',
        dueAt: '2030-01-03T00:00:00.000Z',
        completedAt: null,
        version: 4,
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-02T00:00:00.000Z',
      }],
    });
    expectNoPii(result);
  });

  it('projects timeline, queues and evidence with stable structural metadata only', () => {
    const timeline = safeCrmTimelineDto({
      id: 'timeline-id',
      leadId: 'lead-id',
      opportunityId: null,
      taskId: null,
      eventType: 'ASSIGNMENT_UPDATED',
      actor: 'operator-id',
      createdAt: '2030-01-01T00:00:00.000Z',
      reason: piiCanaries[2],
      previousValue: sensitive,
      newValue: sensitive,
      metadata: { nested: sensitive },
    });
    const evidence = safeEvidenceDto({
      id: 'evidence-id',
      leadId: 'lead-id',
      source: 'SYNTHETIC_TEST',
      confidence: '1.000',
      observedAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2030-01-01T00:00:00.000Z',
      reference: piiCanaries[0],
      result: piiCanaries[2],
      notes: piiCanaries[3],
      fingerprint: piiCanaries[4],
    });
    const queue = safeCrmQueueItemDto({
      task: {
        id: 'task-id',
        leadId: 'lead-id',
        opportunityId: null,
        status: 'PENDENTE',
        priority: 'MEDIA',
        dueAt: '2030-01-02T00:00:00.000Z',
        completedAt: null,
        version: 2,
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-01T00:00:00.000Z',
        title: piiCanaries[0],
        description: piiCanaries[2],
        completionNote: piiCanaries[3],
        owner: piiCanaries[1],
      },
      lead: { ...sensitive, id: 'lead-id', name: 'Empresa Sintética' },
    });
    expect(timeline).toEqual({
      id: 'timeline-id',
      leadId: 'lead-id',
      opportunityId: null,
      taskId: null,
      eventType: 'ASSIGNMENT_UPDATED',
      actor: 'operator-id',
      createdAt: '2030-01-01T00:00:00.000Z',
    });
    expect(evidence).toEqual({
      id: 'evidence-id',
      leadId: 'lead-id',
      source: 'SYNTHETIC_TEST',
      confidence: '1.000',
      observedAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2030-01-01T00:00:00.000Z',
    });
    expect(queue.task).toEqual({
      id: 'task-id',
      leadId: 'lead-id',
      opportunityId: null,
      status: 'PENDENTE',
      priority: 'MEDIA',
      dueAt: '2030-01-02T00:00:00.000Z',
      completedAt: null,
      version: 2,
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
    });
    for (const value of [timeline, evidence, queue]) expectNoPii(value);
  });

  it('projects eligible leads, recipients, attempts and simulations safely', () => {
    const eligible = safeEligibleCampaignLeadDto({
      lead: { ...sensitive, id: 'lead-id' },
      contact: { ...sensitive, id: 'contact-id', leadId: 'lead-id', type: 'EMAIL' },
    });
    const recipient = safeCampaignRecipientDto({
      ...sensitive,
      id: 'recipient-id',
      campaignId: 'campaign-id',
      campaignVersionId: 'version-id',
      leadId: 'lead-id',
      channel: 'EMAIL',
      state: 'PENDENTE',
      version: 1,
    });
    const attempt = safeCampaignAttemptDto({
      ...sensitive,
      id: 'attempt-id',
      recipientId: 'recipient-id',
      state: 'PENDENTE',
      version: 1,
    });
    const simulation = safeCampaignSimulationDto({
      mode: 'SIMULATION',
      dispatched: false,
      items: [{
        recipient: { ...recipient, recipientSnapshot: sensitive },
        attempt: { ...attempt, payloadSnapshot: sensitive },
        simulation: { mode: 'SIMULATION', channel: 'EMAIL', dispatched: false, content: piiCanaries[2] },
      }],
      pagination: { page: 1, pageSize: 20, hasMore: false },
    });
    for (const value of [eligible, recipient, attempt, simulation]) expectNoPii(value);
    expect(simulation).toMatchObject({ mode: 'SIMULATION', dispatched: false });
  });

  it('finds forbidden keys recursively instead of checking only the first level', () => {
    expect(findForbiddenPiiResponseKeys({ safe: [{ nested: { original_value: 'canary' } }] }))
      .toEqual(['$.safe[0].nested.original_value']);
  });

  it('fails closed when required structured CRM metadata is absent', () => {
    expect(() => safeCrmQueueItemDto({
      task: { id: 'task-id' },
      lead: { id: 'lead-id' },
    })).toThrow('SAFE_DTO_REQUIRED_FIELD_MISSING');
  });

  it('covers present and absent optional CRM relationships and values', () => {
    const timeline = safeCrmTimelineDto({
      id: 'timeline-id',
      leadId: 'lead-id',
      opportunityId: 'opportunity-id',
      taskId: 'task-id',
      eventType: 'TASK_UPDATED',
      actor: 'operator-id',
      createdAt: '2030-01-01T00:00:00.000Z',
    });
    const crm = safeCrmDto({
      opportunities: [{
        id: 'opportunity-id',
        leadId: 'lead-id',
        amount: null,
        currency: 'BRL',
        expectedCloseAt: '2030-02-01T00:00:00.000Z',
        closedAt: null,
        outcome: null,
        version: 1,
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-01T00:00:00.000Z',
      }],
      notes: [{
        id: 'note-id',
        leadId: 'lead-id',
        opportunityId: 'opportunity-id',
        createdAt: '2030-01-01T00:00:00.000Z',
      }],
      tasks: [{
        id: 'task-id',
        leadId: 'lead-id',
        opportunityId: 'opportunity-id',
        status: 'CONCLUIDA',
        priority: 'MEDIA',
        dueAt: '2030-01-02T00:00:00.000Z',
        completedAt: '2030-01-02T00:00:00.000Z',
        version: 2,
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-02T00:00:00.000Z',
      }],
    });
    expect(timeline).toMatchObject({ opportunityId: 'opportunity-id', taskId: 'task-id' });
    expect(crm.opportunities[0]).toMatchObject({
      amount: null,
      expectedCloseAt: '2030-02-01T00:00:00.000Z',
      closedAt: null,
      outcome: null,
    });
    expect(crm.notes[0]).toMatchObject({ opportunityId: 'opportunity-id' });
    expect(crm.tasks[0]).toMatchObject({
      opportunityId: 'opportunity-id',
      completedAt: '2030-01-02T00:00:00.000Z',
    });
    expect(crm.tags).toEqual([]);
    expectNoPii([timeline, crm]);
  });

  it('uses empty collections for absent CRM and simulation arrays', () => {
    expect(safeCrmDto(null)).toEqual({
      lead: safeLeadDto(undefined),
      opportunities: [],
      notes: [],
      tags: [],
      tasks: [],
    });
    expect(safeCampaignSimulationDto({ items: null, pagination: null })).toEqual({
      mode: 'SIMULATION',
      dispatched: false,
      items: [],
      pagination: null,
    });
  });

  it('handles primitive, null, object and array values in recursive key checks', () => {
    expect(findForbiddenPiiResponseKeys('safe')).toEqual([]);
    expect(findForbiddenPiiResponseKeys(null)).toEqual([]);
    expect(findForbiddenPiiResponseKeys({ phone: piiCanaries[0] })).toEqual(['$.phone']);
    const nestedPaths = findForbiddenPiiResponseKeys([
      null,
      'safe',
      { nested: [{ payload_snapshot: sensitive }] },
    ]);
    expect(nestedPaths).toContain('$[2].nested[0].payload_snapshot');
    expect(nestedPaths).toContain('$[2].nested[0].payload_snapshot.phone');
  });

  it('fails closed for invalid queue tasks and incomplete evidence', () => {
    expect(() => safeCrmQueueItemDto({ task: null, lead: null }))
      .toThrow('SAFE_DTO_REQUIRED_FIELD_MISSING');
    expect(() => safeEvidenceDto({
      id: 'evidence-id',
      leadId: 'lead-id',
      source: 'SYNTHETIC_TEST',
    })).toThrow('SAFE_DTO_REQUIRED_FIELD_MISSING');
  });
});
