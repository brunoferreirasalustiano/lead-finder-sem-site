import { describe, expect, it } from 'vitest';
import {
  CrmDomainError, assertCrmTransition, canTransitionCrmStage, crmStageChangeSchema,
  crmStages, crmTransitionGraph, followUpFilterSchema, idempotencyKeySchema, moneySchema,
  isEligibleForCommercialQueue, noteCreateSchema, opportunityUpdateSchema, taskCreateSchema, utcDateTimeSchema,
} from './crm.js';

const command = { actor: 'user-1', idempotencyKey: 'request-123', expectedVersion: 0 };

describe('CRM contracts', () => {
  it('defines every stage in the explicit transition graph', () => {
    expect(Object.keys(crmTransitionGraph)).toEqual(crmStages);
    for (const from of crmStages) {
      for (const to of crmStages) {
        expect(canTransitionCrmStage(from, to)).toBe(crmTransitionGraph[from].includes(to));
      }
    }
    expect(crmTransitionGraph.GANHO).toEqual([]);
    expect(crmTransitionGraph.PERDIDO).toEqual([]);
    expect(crmTransitionGraph.NAO_CONTATAR).toEqual([]);
  });

  it('requires a reason to enter NAO_CONTATAR', () => {
    expect(crmStageChangeSchema.safeParse({ ...command, stage: 'NAO_CONTATAR' }).success).toBe(false);
    expect(crmStageChangeSchema.safeParse({ ...command, stage: 'NAO_CONTATAR', reason: 'Opt-out' }).success).toBe(true);
  });

  it('requires explicit audited action to exit NAO_CONTATAR or reopen terminal stages', () => {
    const reactivation = crmStageChangeSchema.parse({ ...command, stage: 'NOVO', action: 'REACTIVATE', reason: 'Consent recorded', auditMetadata: { ticket: '42' } });
    expect(() => assertCrmTransition('NAO_CONTATAR', reactivation)).not.toThrow();
    const ordinary = crmStageChangeSchema.parse({ ...command, stage: 'NOVO' });
    expect(() => assertCrmTransition('NAO_CONTATAR', ordinary)).toThrowError(CrmDomainError);
    const reopen = crmStageChangeSchema.parse({ ...command, stage: 'QUALIFICADO', action: 'REOPEN', reason: 'New request', auditMetadata: { source: 'inbound' } });
    expect(() => assertCrmTransition('PERDIDO', reopen)).not.toThrow();
  });

  it('accepts only UTC timestamps, bounded money and safe idempotency keys', () => {
    expect(utcDateTimeSchema.safeParse('2026-07-11T12:00:00Z').success).toBe(true);
    expect(utcDateTimeSchema.safeParse('2026-07-11T09:00:00-03:00').success).toBe(false);
    expect(moneySchema.safeParse('123456.78').success).toBe(true);
    expect(moneySchema.safeParse('-1.00').success).toBe(false);
    expect(moneySchema.safeParse('1.999').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('request:123_ABC').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('bad key').success).toBe(false);
  });

  it('keeps blocked and incompatible leads out of every commercial queue', () => {
    const eligible = { qualificationStatus: 'SEM_SITE_CONFIRMADO' as const, crmStage: 'QUALIFICADO' as const, isBlocked: false, doNotContact: false };
    expect(isEligibleForCommercialQueue(eligible)).toBe(true);
    expect(isEligibleForCommercialQueue({ ...eligible, qualificationStatus: 'DESCARTADO' })).toBe(false);
    expect(isEligibleForCommercialQueue({ ...eligible, crmStage: 'NAO_CONTATAR' })).toBe(false);
    expect(isEligibleForCommercialQueue({ ...eligible, isBlocked: true })).toBe(false);
    expect(isEligibleForCommercialQueue({ ...eligible, doNotContact: true })).toBe(false);
  });

  it('validates opportunity loss, task text and follow-up boundaries', () => {
    expect(opportunityUpdateSchema.safeParse({ ...command, status: 'PERDIDA' }).success).toBe(false);
    expect(opportunityUpdateSchema.safeParse({ ...command, status: 'PERDIDA', lossReason: 'Budget' }).success).toBe(true);
    expect(taskCreateSchema.safeParse({ title: 'Call', dueAt: '2026-07-11T12:00:00Z', actor: 'a', idempotencyKey: 'task-0001' }).success).toBe(true);
    expect(followUpFilterSchema.safeParse({ from: '2026-07-12T00:00:00Z', to: '2026-07-11T00:00:00Z' }).success).toBe(false);
  });

  it('accepts only valid opportunity UUIDs on notes and tasks', () => {
    const opportunityId = '123e4567-e89b-12d3-a456-426614174000';
    const note = { body: 'Context', actor: 'a', idempotencyKey: 'note-0001' };
    const task = { title: 'Call', dueAt: '2026-07-11T12:00:00Z', actor: 'a', idempotencyKey: 'task-0001' };
    expect(noteCreateSchema.safeParse({ ...note, opportunityId }).success).toBe(true);
    expect(taskCreateSchema.safeParse({ ...task, opportunityId }).success).toBe(true);
    expect(noteCreateSchema.safeParse({ ...note, opportunityId: 'invalid' }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...task, opportunityId: 'invalid' }).success).toBe(false);
  });
});
