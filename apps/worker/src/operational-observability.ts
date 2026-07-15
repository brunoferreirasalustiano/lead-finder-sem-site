export type OperationalOutcome = 'CLAIMED' | 'PUBLISHED' | 'RETRY' | 'STALE_ACK' | 'STALE' | 'DEAD_LETTERED' | 'RECOVERED' | 'RESCHEDULED' | 'INELIGIBLE';
export type SafeOperationalReason = 'DAILY_LIMIT' | 'SPACING' | 'INVALID_CHANNEL' | 'CAMPAIGN_NOT_ACTIVE' | 'RECIPIENT_NOT_EXECUTABLE' | 'ATTEMPT_NOT_EXECUTABLE' | 'LEAD_BLOCKED' | 'DO_NOT_CONTACT' | 'CRM_DO_NOT_CONTACT' | 'CONTACT_NOT_VALIDATED' | 'OPT_OUT' | 'ALREADY_RESPONDED' | 'SIMULATED_TIMEOUT_BEFORE_CONFIRMATION' | 'SIMULATED_EXECUTION_FAILED' | 'FINAL_LEASE_EXPIRED' | 'UNKNOWN';

export interface OperationalLogFields {
  correlationId: string;
  event: string;
  outcome: OperationalOutcome;
  reason?: SafeOperationalReason | undefined;
  campaignId?: string | undefined;
  recipientId?: string | undefined;
  outboxId?: string | undefined;
  attemptId?: string | undefined;
  workerId?: string | undefined;
  generation?: number | undefined;
  deadLetterCycle?: number | undefined;
  durationMs?: number | undefined;
}

const safeReasons = new Set<SafeOperationalReason>([
  'DAILY_LIMIT', 'SPACING', 'INVALID_CHANNEL', 'CAMPAIGN_NOT_ACTIVE', 'RECIPIENT_NOT_EXECUTABLE',
  'ATTEMPT_NOT_EXECUTABLE', 'LEAD_BLOCKED', 'DO_NOT_CONTACT', 'CRM_DO_NOT_CONTACT',
  'CONTACT_NOT_VALIDATED', 'OPT_OUT', 'ALREADY_RESPONDED', 'SIMULATED_TIMEOUT_BEFORE_CONFIRMATION',
  'SIMULATED_EXECUTION_FAILED', 'FINAL_LEASE_EXPIRED', 'UNKNOWN',
]);

export const correlationForOutbox = (outboxId: string, deadLetterCycle: number) =>
  `outbox:${outboxId}:cycle:${deadLetterCycle}`;

export function sanitizeOperationalLog(fields: OperationalLogFields): OperationalLogFields {
  return {
    ...fields,
    reason: fields.reason && safeReasons.has(fields.reason) ? fields.reason : undefined,
    durationMs: fields.durationMs === undefined ? undefined : Math.max(0, Math.round(fields.durationMs)),
  };
}

export interface OperationalLogger {
  info(fields: OperationalLogFields): void;
  error(fields: OperationalLogFields): void;
}

export function createConsoleOperationalLogger(write: (line: string) => void = console.info): OperationalLogger {
  const emit = (fields: OperationalLogFields) => write(JSON.stringify(sanitizeOperationalLog(fields)));
  return { info: emit, error: emit };
}

export interface OperationalMetricsSnapshot {
  claimedCount: number; publishedCount: number; exhaustedCount: number; retryCount: number;
  staleAckCount: number; expiredLeaseCount: number; recoveredLeaseCount: number; deadLetterCount: number;
  throughputRecent: number; averageDurationMs: number; errorsByReason: Record<SafeOperationalReason, number>;
}

export class OperationalMetrics {
  private readonly counts: OperationalMetricsSnapshot = {
    claimedCount: 0, publishedCount: 0, exhaustedCount: 0, retryCount: 0, staleAckCount: 0,
    expiredLeaseCount: 0, recoveredLeaseCount: 0, deadLetterCount: 0, throughputRecent: 0,
    averageDurationMs: 0, errorsByReason: {} as Record<SafeOperationalReason, number>,
  };
  private durationTotal = 0;
  private durationCount = 0;
  record(outcome: OperationalOutcome, reason?: SafeOperationalReason, durationMs?: number) {
    const map: Partial<Record<OperationalOutcome, 'claimedCount' | 'publishedCount' | 'retryCount' | 'staleAckCount' | 'deadLetterCount' | 'recoveredLeaseCount'>> = {
      CLAIMED: 'claimedCount', PUBLISHED: 'publishedCount', RETRY: 'retryCount', STALE_ACK: 'staleAckCount',
      DEAD_LETTERED: 'deadLetterCount', RECOVERED: 'recoveredLeaseCount',
    };
    const target = map[outcome]; if (target) this.counts[target] += 1;
    if (outcome === 'DEAD_LETTERED') this.counts.exhaustedCount += 1;
    if (reason) this.counts.errorsByReason[reason] = (this.counts.errorsByReason[reason] ?? 0) + 1;
    if (durationMs !== undefined) { this.durationTotal += Math.max(0, durationMs); this.durationCount += 1; }
  }
  snapshot(): OperationalMetricsSnapshot {
    return { ...this.counts, throughputRecent: this.counts.publishedCount + this.counts.retryCount,
      averageDurationMs: this.durationCount ? Math.round(this.durationTotal / this.durationCount) : 0,
      errorsByReason: { ...this.counts.errorsByReason } };
  }
}
