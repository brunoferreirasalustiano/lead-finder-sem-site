import { describe, expect, it } from 'vitest';
import { classifyWorkerFailure, formatWorkerFailure } from './failure-classification.js';

describe('worker failure classification', () => {
  it('unwraps database causes without logging SQL and terminates cyclic causes', () => {
    const wrapped = new Error('SQL with private parameters', { cause: { code: '42501' } });
    expect(classifyWorkerFailure('startup', wrapped)).toBe('DATABASE_PERMISSION_DENIED');
    expect(formatWorkerFailure('startup', wrapped)).not.toContain('private');
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(classifyWorkerFailure('startup', cyclic)).toBe('WORKER_FATAL');
  });
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

  it('classifies PostgreSQL permission failures without exposing database details', () => {
    const error = Object.assign(new Error('permission denied for table leads'), { code: '42501' });
    expect(classifyWorkerFailure('Unhandled rejection', error)).toBe('DATABASE_PERMISSION_DENIED');
    const entry = JSON.parse(formatWorkerFailure('Unhandled rejection', error)) as Record<string, unknown>;
    expect(entry).toEqual({
      event: 'worker_fatal',
      failureClass: 'DATABASE_PERMISSION_DENIED',
      decision: 'SHUTDOWN_REQUESTED',
    });
    expect(JSON.stringify(entry)).not.toContain('leads');
    expect(JSON.stringify(entry)).not.toContain('42501');
  });
});
