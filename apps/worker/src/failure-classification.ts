export type WorkerFailureClass =
  | 'COLLECTION_LEASE_LOST'
  | 'DATABASE_PERMISSION_DENIED'
  | 'WORKER_UNHANDLED_REJECTION'
  | 'WORKER_FATAL';

const errorCode = (error: unknown): string | undefined => {
  const visited = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    if ('code' in current && current.code === '42501') return '42501';
    if ('code' in current && current.code === 'COLLECTION_LEASE_LOST') return 'COLLECTION_LEASE_LOST';
    if (current instanceof Error && current.message === 'COLLECTION_LEASE_LOST') return 'COLLECTION_LEASE_LOST';
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
};

/**
 * Converts an unhandled worker failure into a bounded, PII-safe class.
 * The scheduler uses this marker to distinguish a fenced collection lease
 * from an otherwise unknown worker crash without retaining worker output.
 */
export function classifyWorkerFailure(kind: string, error: unknown): WorkerFailureClass {
  if (errorCode(error) === 'COLLECTION_LEASE_LOST') return 'COLLECTION_LEASE_LOST';
  if (errorCode(error) === '42501') return 'DATABASE_PERMISSION_DENIED';
  if (kind === 'Unhandled rejection') return 'WORKER_UNHANDLED_REJECTION';
  return 'WORKER_FATAL';
}

export function formatWorkerFailure(kind: string, error: unknown): string {
  return JSON.stringify({
    event: 'worker_fatal',
    failureClass: classifyWorkerFailure(kind, error),
    decision: 'SHUTDOWN_REQUESTED',
  });
}
