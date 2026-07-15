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
  });
  it('covers disabled guard, completion, missing runs and a fully evidenced go decision', () => {
    const logger = { info: vi.fn() }; expect(new ShadowModeGuard(false, logger).block()).toBe(false);
    const store = new ShadowRunStore(); const run = store.start({ runId: 'run-2', segment: 's', region: 'r', source: 'o', now });
    expect(() => store.addEvidence('missing', 'e', {})).toThrow('NOT_FOUND');
    store.addEvidence('run-2', 'e', { totalCollected: 100, totalDuplicates: 1 });
    expect(store.finish('run-2', now)).toBe(run); expect(store.finish('run-2', now)).toBe(run);
    const result = evaluateShadowGoNoGo(run, { guardBlocked: 1, criticalIncident: false, readiness: true, backup: true, rollback: true, reportGenerated: true, qualificationPrecision: .9, falsePositiveRate: .1 });
    expect(result.status).toBe('GO');
  });
});
