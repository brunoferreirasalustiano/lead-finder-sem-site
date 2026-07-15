import { describe, expect, it } from 'vitest';
import { OperationalMetrics, correlationForOutbox, createConsoleOperationalLogger } from './operational-observability.js';

describe('operational observability', () => {
  it('emits deterministic JSON without payload, contact data, tokens, or arbitrary labels', () => {
    const lines: string[] = []; const logger = createConsoleOperationalLogger((line) => lines.push(line));
    logger.info({ correlationId: correlationForOutbox('outbox-id', 2), event: 'campaign_outbox_completed', outcome: 'PUBLISHED', outboxId: 'outbox-id', workerId: 'worker-a', generation: 3, deadLetterCycle: 2, durationMs: 1.2 } as never);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ event: 'campaign_outbox_completed', outcome: 'PUBLISHED', generation: 3, durationMs: 1 });
    expect(JSON.stringify(entry)).not.toMatch(/payload|email|phone|token|secret|message/i);
  });
  it('uses only bounded reason keys and has deterministic reset semantics', () => {
    const metrics = new OperationalMetrics();
    metrics.record('PUBLISHED', undefined, 8); metrics.record('RETRY', 'SIMULATED_EXECUTION_FAILED', 4);
    metrics.record('STALE_ACK'); metrics.record('DEAD_LETTERED', 'FINAL_LEASE_EXPIRED'); metrics.record('RECOVERED');
    expect(metrics.snapshot()).toMatchObject({ publishedCount: 1, retryCount: 1, staleAckCount: 1, deadLetterCount: 1, exhaustedCount: 1, recoveredLeaseCount: 1, averageDurationMs: 6, errorsByReason: { SIMULATED_EXECUTION_FAILED: 1, FINAL_LEASE_EXPIRED: 1 } });
    expect(new OperationalMetrics().snapshot()).toEqual(new OperationalMetrics().snapshot());
  });
});
