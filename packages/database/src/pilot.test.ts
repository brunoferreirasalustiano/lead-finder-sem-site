import { describe, expect, it } from 'vitest';
import { createAuthorizationContext } from '@lead-finder/shared';
import type { Database } from './index.js';
import { addPilotLead, PilotPersistenceError, pilotFingerprint } from './pilot.js';

const pilotRunId = '00000000-0000-4000-8000-000000000001';
const leadId = '00000000-0000-4000-8000-000000000002';
const authorization = createAuthorizationContext({
  principalId: 'pilot-test',
  permissions: new Set(['pilot:write']),
  authenticationMethod: 'unit-test',
});
const addLeadInput = {
  leadId,
  source: 'SYNTHETIC' as const,
  expectedVersion: 1,
  idempotencyKey: 'pilot-lead-conflict-test',
};

const addLeadWithInsertError = (insertError: unknown) => {
  let selectCall = 0;
  const tx = {
    execute: () => Promise.resolve(selectCall === 2 ? [{
      id: leadId,
      qualification_status: 'SEM_SITE_CONFIRMADO',
      is_blocked: false,
      do_not_contact: false,
      crm_stage: null,
      city: 'Regiao Ficticia',
      category: 'Categoria Ficticia',
      has_contact: true,
      has_opt_out: false,
    }] : []),
    select: () => {
      selectCall += 1;
      const rows = selectCall === 1 ? [] : selectCall === 2 ? [{
        id: pilotRunId,
        status: 'DRAFT',
        version: 1,
        region: 'Regiao Ficticia',
        category: 'Categoria Ficticia',
        targetLeadCount: 1,
      }] : [{ value: 0 }];
      const builder = {
        from: () => builder,
        where: () => builder,
        for: () => builder,
        limit: () => Promise.resolve(rows),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return builder;
    },
    insert: () => ({ values: () => ({ returning: () => { throw insertError; } }) }),
  };
  const db = { transaction: (operation: (transaction: typeof tx) => unknown) => Promise.resolve(operation(tx)) } as unknown as Database;
  return addPilotLead(db, pilotRunId, addLeadInput, authorization);
};

const addLeadWithStoredFingerprint = (payloadFingerprint: string) => {
  const storedResult = { pilotRunId, leadId, source: 'SYNTHETIC', addedBy: 'pilot-test', version: 1 };
  const rows = [{ payloadFingerprint, result: storedResult }];
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => Promise.resolve(rows),
  };
  const tx = {
    execute: () => Promise.resolve([]),
    select: () => builder,
  };
  const db = { transaction: (operation: (transaction: typeof tx) => unknown) => Promise.resolve(operation(tx)) } as unknown as Database;
  return { operation: addPilotLead(db, pilotRunId, addLeadInput, authorization), storedResult };
};

describe('pilot persistence primitives', () => {
  it('uses a canonical payload fingerprint for idempotency', () => {
    expect(pilotFingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(pilotFingerprint({ a: { c: 3, d: 4 }, b: 2 }));
    expect(pilotFingerprint({ a: 1 })).not.toBe(pilotFingerprint({ a: 2 }));
  });
  it('exposes stable sanitized persistence error codes', () => {
    expect(new PilotPersistenceError('conflict', 'VERSION_CONFLICT')).toMatchObject({ name: 'PilotPersistenceError', code: 'VERSION_CONFLICT' });
  });
  it.each([
    [{ code: '23505' }],
    [{ cause: { code: '23505' } }],
    [{ cause: { cause: { code: '23505' } } }],
  ])('normalizes direct and wrapped PostgreSQL uniqueness errors', async (error) => {
    await expect(addLeadWithInsertError(error)).rejects.toMatchObject({
      code: 'LOGICAL_CONFLICT',
      message: 'Lead already belongs to this or another active pilot',
    });
  });
  it.each([
    [{ code: '23503' }],
    [{ cause: { code: '23514' } }],
    [new Error('synthetic failure')],
  ])('preserves non-uniqueness errors', async (error) => {
    await expect(addLeadWithInsertError(error)).rejects.toBe(error);
  });
  it.each([null, undefined, 'failure', 42, false])('handles primitive failures without throwing a TypeError', async (error) => {
    try {
      await addLeadWithInsertError(error);
      throw new Error('expected addPilotLead to reject');
    } catch (caught) {
      expect(caught).toBe(error);
    }
  });
  it('preserves idempotency replay behavior', async () => {
    const payload = { pilotRunId, ...addLeadInput };
    const { operation, storedResult } = addLeadWithStoredFingerprint(pilotFingerprint(payload));
    await expect(operation).resolves.toEqual({ data: storedResult, replayed: true });
  });
  it('preserves divergent idempotency payload behavior', async () => {
    const { operation } = addLeadWithStoredFingerprint(pilotFingerprint({ divergent: true }));
    await expect(operation).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
