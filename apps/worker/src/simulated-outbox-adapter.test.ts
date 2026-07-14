import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmSimulatedCampaignExecution, type Database } from '@lead-finder/database';
import { SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';

vi.mock('@lead-finder/database', () => ({ confirmSimulatedCampaignExecution: vi.fn() }));

const input = {
  id: '00000000-0000-4000-8000-000000000001', deadLetterCycle: 0,
  executionId: '00000000-0000-4000-8000-000000000002',
  attemptId: '00000000-0000-4000-8000-000000000003', channel: 'EMAIL',
  workerId: 'worker-a', token: '00000000-0000-4000-8000-000000000004', generation: 1,
  confirmedAt: new Date('2030-01-01T12:00:00.000Z'),
};

describe('SimulatedOutboxAdapter', () => {
  beforeEach(() => vi.mocked(confirmSimulatedCampaignExecution).mockReset());

  it('times out before confirmation without touching durable storage', async () => {
    const adapter = new SimulatedOutboxAdapter({} as Database, 'TIMEOUT_BEFORE_CONFIRMATION');
    await expect(adapter.execute(input)).rejects.toMatchObject({
      code: 'SIMULATED_TIMEOUT_BEFORE_CONFIRMATION',
    });
    expect(confirmSimulatedCampaignExecution).not.toHaveBeenCalled();
  });

  it('persists confirmation before the deterministic after-confirmation timeout', async () => {
    vi.mocked(confirmSimulatedCampaignExecution).mockResolvedValue({ executionId: input.executionId, replayed: false });
    const adapter = new SimulatedOutboxAdapter({} as Database, 'TIMEOUT_AFTER_CONFIRMATION');
    await expect(adapter.execute(input)).rejects.toMatchObject({
      code: 'SIMULATED_TIMEOUT_AFTER_CONFIRMATION',
    });
    expect(confirmSimulatedCampaignExecution).toHaveBeenCalledWith(expect.anything(), {
      executionId: input.executionId, outboxId: input.id, cycle: input.deadLetterCycle,
      attemptId: input.attemptId, channel: input.channel, workerId: input.workerId,
      token: input.token, generation: input.generation, confirmedAt: input.confirmedAt,
    });
  });

  it('reconciles the same execution after restart without a second logical execution', async () => {
    vi.mocked(confirmSimulatedCampaignExecution).mockResolvedValue({ executionId: input.executionId, replayed: true });
    const restartedAdapter = new SimulatedOutboxAdapter({} as Database);
    await expect(restartedAdapter.execute(input)).resolves.toEqual({
      executionId: input.executionId, replayed: true, reconciled: true,
    });
  });
});
