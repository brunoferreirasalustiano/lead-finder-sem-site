import { describe, expect, it } from 'vitest';
import { classifyWorkerFailure, formatWorkerFailure } from './failure-classification.js';

describe('worker failure classification', () => {
  it('marks a fenced collection lease without exposing the underlying error', () => {
    expect(classifyWorkerFailure('Unhandled rejection', new Error('COLLECTION_LEASE_LOST'))).toBe('COLLECTION_LEASE_LOST');
    const entry = JSON.parse(formatWorkerFailure('Unhandled rejection', new Error('contact@example.test'))) as Record<string, unknown>;
    expect(entry).toEqual({ event: 'worker_fatal', failureClass: 'WORKER_UNHANDLED_REJECTION', decision: 'SHUTDOWN_REQUESTED' });
    expect(JSON.stringify(entry)).not.toContain('contact@example.test');
  });

  it('keeps ordinary fatal classes bounded', () => {
    expect(classifyWorkerFailure('Unhandled rejection', new Error('provider failed'))).toBe('WORKER_UNHANDLED_REJECTION');
    expect(classifyWorkerFailure('startup', new Error('provider failed'))).toBe('WORKER_FATAL');
  });
});
