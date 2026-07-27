import { describe, expect, it } from 'vitest';
import {
  safeLeadMutationResult,
  safeNoteMutationResult,
  safeOpportunityMutationResult,
  safeTagMutationResult,
  safeTaskMutationResult,
} from './crm-mutation-projections.js';

const marker = 'PII_CRM_MARKER_private@example.test_5511777777777';
const serialized = (value: unknown) => JSON.stringify(value);
const expectSafe = (value: unknown) => {
  expect(serialized(value)).not.toMatch(/PII_CRM_MARKER|private@example\.test|5511777777777/);
  expect(serialized(value)).not.toMatch(/"(?:name|title|body|description|owner|author|lossReason|crmOwner)"/);
};

describe('CRM mutation result projections', () => {
  it('projects lead mutations without identity or owner fields', () => {
    const result = safeLeadMutationResult({
      id: 'lead-1', name: marker, phone: '5511777777777', email: 'private@example.test',
      crmOwner: marker, qualificationStatus: 'SEM_SITE_CONFIRMADO', isBlocked: false,
      doNotContact: false, crmStage: 'QUALIFICADO', crmPriority: 'ALTA',
      crmNextActionAt: new Date('2030-01-01T00:00:00.000Z'), crmVersion: 2,
      crmUpdatedAt: new Date('2030-01-01T00:00:00.000Z'),
      createdAt: new Date('2029-01-01T00:00:00.000Z'), updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    expectSafe(result);
    expect(result).toMatchObject({ id: 'lead-1', crmStage: 'QUALIFICADO', crmVersion: 2 });
    expect(result.crmNextActionAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('projects opportunity, note and task mutations without free text', () => {
    const opportunity = safeOpportunityMutationResult({
      id: 'opportunity-1', leadId: 'lead-1', title: marker, owner: marker,
      lossReason: marker, amount: '1000.00', currency: 'BRL', expectedCloseAt: null,
      closedAt: null, outcome: null, version: 1,
      createdAt: new Date('2030-01-01T00:00:00.000Z'), updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const note = safeNoteMutationResult({
      id: 'note-1', leadId: 'lead-1', opportunityId: null, body: marker, author: marker,
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const task = safeTaskMutationResult({
      id: 'task-1', leadId: 'lead-1', opportunityId: null, title: marker,
      description: marker, owner: marker, completionNote: marker, status: 'PENDENTE',
      priority: 'MEDIA', dueAt: new Date('2030-02-01T00:00:00.000Z'),
      completedAt: null, version: 1,
      createdAt: new Date('2030-01-01T00:00:00.000Z'), updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    for (const result of [opportunity, note, task]) expectSafe(result);
    expect(opportunity).toMatchObject({ id: 'opportunity-1', leadId: 'lead-1', currency: 'BRL' });
    expect(note).toEqual({
      schemaVersion: 1, resourceType: 'note', id: 'note-1', leadId: 'lead-1',
      opportunityId: null, createdAt: '2030-01-01T00:00:00.000Z',
    });
    expect(task).toMatchObject({ id: 'task-1', leadId: 'lead-1', status: 'PENDENTE' });
  });

  it('preserves safe tag response shapes for add and remove', () => {
    const added = safeTagMutationResult({ id: 'tag-1', leadId: 'lead-1', name: marker, createdAt: new Date('2030-01-01T00:00:00.000Z') });
    const removed = safeTagMutationResult({ removed: true, tagId: 'tag-1', leadId: 'lead-1', name: marker });
    expectSafe(added);
    expectSafe(removed);
    expect(added).toMatchObject({ id: 'tag-1', leadId: 'lead-1' });
    expect(removed).toEqual({ schemaVersion: 1, resourceType: 'tag', removed: true, tagId: 'tag-1', leadId: 'lead-1' });
  });
});
