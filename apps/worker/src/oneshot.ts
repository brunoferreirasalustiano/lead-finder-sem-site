export type OneShotJobProcessor = () => Promise<boolean>;

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
