import { describe, expect, it, vi } from 'vitest';
import { claimCampaignOutbox, completeCampaignOutbox, type Database } from '@lead-finder/database';
import { processNextOutbox } from './process-outbox.js';
import { SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';

vi.mock('@lead-finder/database', () => ({
  claimCampaignOutbox: vi.fn().mockResolvedValue(null),
  completeCampaignOutbox: vi.fn(),
}));

describe('processNextOutbox', () => {
  it('does not invoke the adapter when no item is available', async () => {
    const adapter = new SimulatedOutboxAdapter();
    const execute = vi.spyOn(adapter, 'execute');
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(processNextOutbox({} as Database, adapter, { workerId: 'worker-a', leaseMs: 1_000 }, logger)).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('preserves the claimed item on failure and logs no payload data', async () => {
    vi.mocked(claimCampaignOutbox).mockResolvedValueOnce({
      id: 'outbox-1', eventType: 'SIMULATED', payload: { contact: 'private@example.test' },
      idempotencyKey: 'key-1', workerId: 'worker-a', token: crypto.randomUUID(), generation: 1,
      expiresAt: new Date('2030-01-01T00:00:10Z'),
    });
    const adapter = new SimulatedOutboxAdapter();
    vi.spyOn(adapter, 'execute').mockRejectedValueOnce(new Error('provider included private@example.test'));
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(processNextOutbox({} as Database, adapter, { workerId: 'worker-a', leaseMs: 1_000 }, logger)).resolves.toBe(true);
    expect(completeCampaignOutbox).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private@example.test');
    expect(logger.error).toHaveBeenCalledWith('campaign_outbox_processing_failed', { outboxId: 'outbox-1', generation: 1 });
  });
});
