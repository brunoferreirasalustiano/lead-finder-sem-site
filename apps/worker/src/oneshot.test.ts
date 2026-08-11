import { describe, expect, it, vi } from 'vitest';
import { runOneShot } from './oneshot.js';

describe('bounded one-shot worker', () => {
  it('processes at most the configured number of jobs and exits', async () => {
    const processJob = vi.fn().mockResolvedValue(true);
    await expect(runOneShot(processJob, 1)).resolves.toBe(1);
    expect(processJob).toHaveBeenCalledTimes(1);
  });

  it('does not process a second time when no pending job remains', async () => {
    const processJob = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(runOneShot(processJob, 10)).resolves.toBe(1);
    expect(processJob).toHaveBeenCalledTimes(2);
  });

  it('stops cleanly when shutdown is requested', async () => {
    let running = true;
    const processJob = vi.fn().mockImplementation(() => { running = false; return Promise.resolve(true); });
    await expect(runOneShot(processJob, 10, () => running)).resolves.toBe(1);
  });
});
