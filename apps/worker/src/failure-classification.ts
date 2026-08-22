export type WorkerFailureClass = 'COLLECTION_LEASE_LOST' | 'WORKER_UNHANDLED_REJECTION' | 'WORKER_FATAL';

const errorCode = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  if (error instanceof Error) return error.message.split(':', 1)[0]?.trim();
  return undefined;
};

/**
 * Converts an unhandled worker failure into a bounded, PII-safe class.
 * The scheduler uses this marker to distinguish a fenced collection lease
 * from an otherwise unknown worker crash without retaining worker output.
 */
export function classifyWorkerFailure(kind: string, error: unknown): WorkerFailureClass {
  if (errorCode(error) === 'COLLECTION_LEASE_LOST') return 'COLLECTION_LEASE_LOST';
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
