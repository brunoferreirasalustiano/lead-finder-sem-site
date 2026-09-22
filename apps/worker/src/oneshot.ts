export type OneShotJobProcessor = () => Promise<boolean>;

export type OneShotOutcome = 'SUCCESS' | 'NO_JOB_CLAIMED' | 'COLLECTION_SOURCE_FAILURE';

export function classifyOneShotOutcome(processed: number, running: boolean, sourceFailure: boolean): OneShotOutcome {
  if (sourceFailure) return 'COLLECTION_SOURCE_FAILURE';
  if (processed === 0 && running) return 'NO_JOB_CLAIMED';
  return 'SUCCESS';
}

export async function runOneShot(
  processJob: OneShotJobProcessor,
  maxJobs: number,
  isRunning: () => boolean = () => true,
): Promise<number> {
  const boundedMaxJobs = Math.max(1, Math.min(Math.floor(maxJobs), 10));
  let processed = 0;
  while (isRunning() && processed < boundedMaxJobs) {
    const claimed = await processJob();
    if (!claimed) break;
    processed += 1;
  }
  return processed;
}
