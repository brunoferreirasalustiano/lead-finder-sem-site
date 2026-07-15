export type ShadowRunStatus = 'ACTIVE' | 'COMPLETED' | 'ABORTED';
export type GoNoGoStatus = 'GO' | 'NO_GO' | 'NOT_RUN';
export type SafeShadowEvent = 'SHADOW_MODE_BLOCKED' | 'SHADOW_RUN_STARTED' | 'SHADOW_RUN_FINISHED' | 'SHADOW_RUN_ABORTED';
export interface ShadowLogger { info(event: string, metadata: Record<string, string | number | boolean>): void; }
export interface ShadowCounts { totalCollected: number; totalQualified: number; totalRejected: number; totalDuplicates: number; totalBlocked: number; totalOptOut: number; totalWithoutWebsite: number; totalInadequatePresence: number; totalValidContacts: number; totalProbableWhatsapp: number; totalConfirmedWhatsapp: number; totalHighScore: number; totalMediumScore: number; totalLowScore: number; falsePositiveSampleCount: number | null; humanReviewSampleCount: number | null; }
export interface ShadowRun extends ShadowCounts { runId: string; startedAt: string; finishedAt: string | null; segment: string; region: string; source: string; status: ShadowRunStatus; incidents: string[]; warnings: string[]; evidenceIds: string[]; generatedAt: string | null; abortReason: string | null; }
const shadowIdentifierPattern = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,63})$/;
export function parseShadowIdentifier(value: string, field = 'shadow identifier'): string {
  const normalized = value.trim();
  if (!shadowIdentifierPattern.test(normalized)) throw new Error(`INVALID_${field.toUpperCase().replaceAll(' ', '_')}`);
  return normalized;
}
const countKeys = [
  'totalCollected', 'totalQualified', 'totalRejected', 'totalDuplicates', 'totalBlocked', 'totalOptOut',
  'totalWithoutWebsite', 'totalInadequatePresence', 'totalValidContacts', 'totalProbableWhatsapp',
  'totalConfirmedWhatsapp', 'totalHighScore', 'totalMediumScore', 'totalLowScore',
  'falsePositiveSampleCount', 'humanReviewSampleCount',
] as const satisfies readonly (keyof ShadowCounts)[];
const countKeySet = new Set<string>(countKeys);
const zero = (): ShadowCounts => ({ totalCollected: 0, totalQualified: 0, totalRejected: 0, totalDuplicates: 0, totalBlocked: 0, totalOptOut: 0, totalWithoutWebsite: 0, totalInadequatePresence: 0, totalValidContacts: 0, totalProbableWhatsapp: 0, totalConfirmedWhatsapp: 0, totalHighScore: 0, totalMediumScore: 0, totalLowScore: 0, falsePositiveSampleCount: null, humanReviewSampleCount: null });
export class ShadowModeGuard {
  blockedCount = 0;
  constructor(readonly enabled: boolean, private readonly logger: ShadowLogger) {}
  block(runId = 'unscoped'): boolean { if (!this.enabled) return false; this.blockedCount++; this.logger.info('shadow_mode_outbound_blocked', { event: 'SHADOW_MODE_BLOCKED', outcome: 'BLOCKED', reason: 'SHADOW_MODE_BLOCKED', runId, durationMs: 0 }); return true; }
}
export class ShadowRunStore {
  private readonly runs = new Map<string, ShadowRun>();
  start(input: { runId: string; segment: string; region: string; source: string; now: Date }): ShadowRun {
    const runId = parseShadowIdentifier(input.runId, 'run id');
    const prior = this.runs.get(runId);
    if (prior) return prior;
    if (!Number.isFinite(input.now.getTime())) throw new Error('INVALID_SHADOW_DATE');
    const run: ShadowRun = {
      runId,
      segment: parseShadowIdentifier(input.segment, 'segment'),
      region: parseShadowIdentifier(input.region, 'region'),
      source: parseShadowIdentifier(input.source, 'source'),
      startedAt: input.now.toISOString(), finishedAt: null, status: 'ACTIVE', incidents: [], warnings: [],
      evidenceIds: [], generatedAt: null, abortReason: null, ...zero(),
    };
    this.runs.set(run.runId, run);
    return run;
  }
  get(runId: string) { return this.runs.get(runId); }
  addEvidence(runId: string, evidenceId: string, counts: Partial<ShadowCounts>) {
    const run = this.require(parseShadowIdentifier(runId, 'run id'));
    const safeEvidenceId = parseShadowIdentifier(evidenceId, 'evidence id');
    if (run.evidenceIds.includes(safeEvidenceId)) return run;
    if (run.status !== 'ACTIVE') throw new Error('SHADOW_RUN_NOT_ACTIVE');
    for (const [key, value] of Object.entries(counts)) {
      if (!countKeySet.has(key) || !Number.isSafeInteger(value) || (value as number) < 0)
        throw new Error('INVALID_SHADOW_COUNTS');
      const countKey = key as (typeof countKeys)[number];
      const next = (run[countKey] ?? 0) + (value as number);
      if (!Number.isSafeInteger(next)) throw new Error('INVALID_SHADOW_COUNTS');
    }
    run.evidenceIds.push(safeEvidenceId);
    for (const [key, value] of Object.entries(counts)) {
      const countKey = key as (typeof countKeys)[number];
      run[countKey] = (run[countKey] ?? 0) + (value as number);
    }
    return run;
  }
  finish(runId: string, now: Date) { const run = this.require(runId); if (run.status === 'ACTIVE') { run.status = 'COMPLETED'; run.finishedAt = now.toISOString(); } return run; }
  abort(runId: string, reason: 'OPERATOR_ABORT' | 'SAFETY_ABORT', now: Date) { const run = this.require(runId); if (run.status === 'ACTIVE') { run.status = 'ABORTED'; run.abortReason = reason; run.finishedAt = now.toISOString(); } return run; }
  private require(id: string) { const run = this.runs.get(id); if (!run) throw new Error('SHADOW_RUN_NOT_FOUND'); return run; }
}
export function evaluateShadowGoNoGo(run: ShadowRun, input: { guardBlocked: number; criticalIncident: boolean; readiness: boolean; backup: boolean; rollback: boolean; reportGenerated: boolean; maxDuplicateRate?: number; minQualifiedPrecision?: number; minValidContactRate?: number; qualificationPrecision?: number | null; falsePositiveRate?: number | null }): { status: GoNoGoStatus; criteria: Record<string, 'PASS' | 'FAIL' | 'NOT_RUN'> } { const duplicateRate = run.totalCollected ? run.totalDuplicates / run.totalCollected : null; const validContactRate = run.totalCollected ? run.totalValidContacts / run.totalCollected : null; const criteria = { noOutbound: input.guardBlocked > 0 ? 'PASS' : 'NOT_RUN', duplicates: duplicateRate === null ? 'NOT_RUN' : duplicateRate <= (input.maxDuplicateRate ?? .05) ? 'PASS' : 'FAIL', validContacts: validContactRate === null ? 'NOT_RUN' : validContactRate >= (input.minValidContactRate ?? .70) ? 'PASS' : 'FAIL', precision: input.qualificationPrecision == null ? 'NOT_RUN' : input.qualificationPrecision >= (input.minQualifiedPrecision ?? .85) ? 'PASS' : 'FAIL', falsePositive: input.falsePositiveRate == null ? 'NOT_RUN' : input.falsePositiveRate <= .15 ? 'PASS' : 'FAIL', readiness: input.readiness ? 'PASS' : 'FAIL', backup: input.backup ? 'PASS' : 'FAIL', rollback: input.rollback ? 'PASS' : 'FAIL', report: input.reportGenerated ? 'PASS' : 'FAIL' } as const; return { status: input.criticalIncident || Object.values(criteria).some((v) => v !== 'PASS') ? 'NO_GO' : 'GO', criteria }; }
export function createShadowReport(run: ShadowRun, goNoGo: ReturnType<typeof evaluateShadowGoNoGo>, input: { backlog: number; deadLetters: number; retries: number; guardBlocked: number; now: Date }) {
  const volume = Object.fromEntries(countKeys.map((key) => [key, run[key]])) as Pick<ShadowCounts, (typeof countKeys)[number]>;
  return { schemaVersion: '1.0', containsPii: false, period: { startUtc: run.startedAt, endUtc: run.finishedAt },
    scope: { segment: run.segment, region: run.region, source: run.source },
    readiness: { phase: 'SHADOW_MODE', percentage: goNoGo.status === 'GO' ? 100 : 0, decision: goNoGo.status, criteria: goNoGo.criteria },
    volume, operational: { backlog: input.backlog, deadLetters: input.deadLetters, retries: input.retries, shadowModeBlocked: input.guardBlocked },
    commercialFunnel: { contacted: 'NOT_RUN', responses: 'NOT_RUN', meetings: 'NOT_RUN', proposals: 'NOT_RUN', sales: 'NOT_RUN' },
    generatedAt: input.now.toISOString() };
}
