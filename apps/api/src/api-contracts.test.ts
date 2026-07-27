import { describe, expect, it } from 'vitest';
import {
  findForbiddenPiiResponseKeys,
  safeCampaignAttemptDto,
  safeCampaignRecipientDto,
  safeCampaignSimulationDto,
  safeContactDto,
  safeCrmDto,
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
      opportunities: [{ id: 'opportunity-id', leadId: 'lead-id', title: piiCanaries[2] }],
      notes: [{ id: 'note-id', leadId: 'lead-id', body: piiCanaries[3] }],
      tags: [{ id: 'tag-id', leadId: 'lead-id', name: piiCanaries[2] }],
      tasks: [{ id: 'task-id', leadId: 'lead-id', title: piiCanaries[0] }],
    });
    expect(result).toMatchObject({ lead: { id: 'lead-id' } });
    expectNoPii(result);
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
});
