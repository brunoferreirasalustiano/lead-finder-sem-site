import { describe, expect, it, vi } from 'vitest';
import { ShadowModeGuard, ShadowRunStore, createShadowReport, evaluateShadowGoNoGo } from './shadow-mode.js';
const now = new Date('2030-01-01T00:00:00Z');
describe('shadow mode runtime', () => {
  it('is deterministic, idempotent, sanitized and forces no-go when evidence is incomplete', () => {
    const logger = { info: vi.fn() }; const guard = new ShadowModeGuard(true, logger); expect(guard.block('run-1')).toBe(true); expect(guard.blockedCount).toBe(1);
    const store = new ShadowRunStore(); const run = store.start({ runId: 'run-1', segment: 'local-services', region: 'SP', source: 'osm', now });
    expect(store.start({ runId: 'run-1', segment: 'x', region: 'x', source: 'x', now })).toBe(run);
    store.addEvidence('run-1', 'e-1', { totalCollected: 10, totalDuplicates: 1 }); store.addEvidence('run-1', 'e-1', { totalCollected: 10 });
    const result = evaluateShadowGoNoGo(run, { guardBlocked: 1, criticalIncident: true, readiness: true, backup: true, rollback: true, reportGenerated: true, qualificationPrecision: .9, falsePositiveRate: .1 });
    expect(result.status).toBe('NO_GO'); const report = createShadowReport(store.abort('run-1', 'SAFETY_ABORT', now), result, { backlog: 0, deadLetters: 0, retries: 0, guardBlocked: 1, now });
    expect(store.abort('run-1', 'SAFETY_ABORT', now).status).toBe('ABORTED'); expect(report.commercialFunnel.contacted).toBe('NOT_RUN'); expect(JSON.stringify(report)).not.toMatch(/@|phone|message|secret/i); expect(run.totalCollected).toBe(10);
    expect(report.volume).toEqual(expect.objectContaining({ totalCollected: 10, totalDuplicates: 1 }));
    expect(report.volume).not.toHaveProperty('runId'); expect(report.volume).not.toHaveProperty('incidents');
    expect(createShadowReport(run, result, { backlog: 0, deadLetters: 0, retries: 0, guardBlocked: 1, now })).toEqual(report);
  });
  it('covers disabled guard, completion, missing runs and a fully evidenced go decision', () => {
    const logger = { info: vi.fn() }; expect(new ShadowModeGuard(false, logger).block()).toBe(false);
    const store = new ShadowRunStore(); const run = store.start({ runId: 'run-2', segment: 's', region: 'r', source: 'o', now });
    expect(() => store.addEvidence('missing', 'e', {})).toThrow('NOT_FOUND');
    store.addEvidence('run-2', 'e', { totalCollected: 100, totalDuplicates: 1, totalValidContacts: 70 });
    expect(store.finish('run-2', now)).toBe(run); expect(store.finish('run-2', now)).toBe(run);
    const result = evaluateShadowGoNoGo(run, { guardBlocked: 1, criticalIncident: false, readiness: true, backup: true, rollback: true, reportGenerated: true, qualificationPrecision: .9, falsePositiveRate: .1 });
    expect(result.status).toBe('GO');
  });
  it.each([[0, 'NO_GO'], [69, 'NO_GO'], [70, 'GO'], [71, 'GO']])('requires 70 percent valid contacts: %i', (contacts, status) => {
    const store = new ShadowRunStore(); const run = store.start({ runId: `contacts-${contacts}`, segment: 's', region: 'r', source: 'o', now });
    store.addEvidence(run.runId, 'e', { totalCollected: 100, totalValidContacts: contacts });
    expect(evaluateShadowGoNoGo(run, { guardBlocked: 1, criticalIncident: false, readiness: true, backup: true, rollback: true, reportGenerated: true, qualificationPrecision: .9, falsePositiveRate: .1 }).status).toBe(status);
  });
  it('supports custom contact threshold and never approves no collected leads', () => {
    const store = new ShadowRunStore(); const run = store.start({ runId: 'empty', segment: 's', region: 'r', source: 'o', now });
    const base = { guardBlocked: 1, criticalIncident: false, readiness: true, backup: true, rollback: true, reportGenerated: true, qualificationPrecision: .9, falsePositiveRate: .1 };
    expect(evaluateShadowGoNoGo(run, base).status).toBe('NO_GO'); store.addEvidence('empty', 'e', { totalCollected: 100, totalValidContacts: 79 });
    expect(evaluateShadowGoNoGo(run, { ...base, minValidContactRate: .8 }).criteria.validContacts).toBe('FAIL'); store.addEvidence('empty', 'next', { totalValidContacts: 1 });
    expect(evaluateShadowGoNoGo(run, { ...base, minValidContactRate: .8 }).criteria.validContacts).toBe('PASS');
  });
  it.each([
    ['run id', { runId: '../escape', segment: 'segment', region: 'SP', source: 'osm' }],
    ['segment', { runId: 'run-safe', segment: 'private@example.test', region: 'SP', source: 'osm' }],
    ['region', { runId: 'run-safe', segment: 'segment', region: 'token:secret', source: 'osm' }],
    ['source', { runId: 'run-safe', segment: 'segment', region: 'SP', source: 'message text' }],
  ])('rejects unsafe %s metadata before persistence or reporting', (_field, input) => {
    expect(() => new ShadowRunStore().start({ ...input, now })).toThrow('INVALID_');
  });
  it('rejects unknown, negative, non-finite, fractional and overflowing evidence counts', () => {
    const store = new ShadowRunStore();
    const run = store.start({ runId: 'run-counts', segment: 'segment', region: 'SP', source: 'osm', now });
    for (const counts of [
      { constructor: 1 }, { totalCollected: -1 }, { totalCollected: Number.NaN },
      { totalCollected: Number.POSITIVE_INFINITY }, { totalCollected: 1.5 },
    ]) expect(() => store.addEvidence(run.runId, 'evidence-safe', counts as never)).toThrow('INVALID_SHADOW_COUNTS');
    store.addEvidence(run.runId, 'evidence-valid', { totalCollected: Number.MAX_SAFE_INTEGER });
    expect(() => store.addEvidence(run.runId, 'evidence-overflow', { totalCollected: 1 })).toThrow('INVALID_SHADOW_COUNTS');
  });
});
