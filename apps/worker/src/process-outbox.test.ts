import { describe, expect, it, vi } from 'vitest';
import {
  authorizeCampaignExecution, claimCampaignOutbox, completeCampaignOutbox, failCampaignOutbox, type Database,
} from '@lead-finder/database';
import { processNextOutbox } from './process-outbox.js';
import { SimulatedExecutionError, SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';

vi.mock('@lead-finder/database', () => ({
  claimCampaignOutbox: vi.fn().mockResolvedValue(null),
  authorizeCampaignExecution: vi.fn(),
  completeCampaignOutbox: vi.fn(),
  failCampaignOutbox: vi.fn(),
}));

const now = new Date('2030-01-01T12:00:00.000Z');
const policy = {
  dailyLimitEmail: 10, dailyLimitWhatsapp: 10, windowStartUtc: '08:00', windowEndUtc: '18:00',
  minSpacingMs: 1_000, maxAttempts: 3, retryBaseMs: 2_000, retryMaxMs: 8_000,
};
const input = { workerId: 'worker-a', leaseMs: 1_000, policy, now };
const claimed = {
  id: '00000000-0000-4000-8000-000000000001', eventType: 'ATTEMPT_CREATED',
  payload: { contact: 'private@example.test' }, idempotencyKey: 'key-1', workerId: 'worker-a',
  token: '00000000-0000-4000-8000-000000000002', generation: 1, attempt: 1,
  expiresAt: new Date('2030-01-01T12:00:10Z'),
  deadLetterCycle: 0,
};

describe('processNextOutbox', () => {
  it('does not invoke the adapter when no item is available', async () => {
    const adapter = new SimulatedOutboxAdapter({} as Database);
    const execute = vi.spyOn(adapter, 'execute');
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(processNextOutbox({} as Database, adapter, input, logger)).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not invoke the adapter when transactional revalidation rejects execution', async () => {
    vi.mocked(claimCampaignOutbox).mockResolvedValueOnce(claimed);
    vi.mocked(authorizeCampaignExecution).mockResolvedValueOnce({
      decision: 'INELIGIBLE', channel: 'EMAIL', reason: 'OPT_OUT',
    });
    const adapter = new SimulatedOutboxAdapter({} as Database);
    const execute = vi.spyOn(adapter, 'execute');
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(processNextOutbox({} as Database, adapter, input, logger)).resolves.toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('private@example.test');
  });

  it('preserves and reschedules the claimed item on adapter failure without leaking sensitive data', async () => {
    vi.mocked(claimCampaignOutbox).mockResolvedValueOnce(claimed);
    vi.mocked(authorizeCampaignExecution).mockResolvedValueOnce({
      decision: 'STARTED', channel: 'EMAIL', attemptId: '00000000-0000-4000-8000-000000000003',
      executionId: '00000000-0000-4000-8000-000000000004', startedAt: now,
    });
    vi.mocked(failCampaignOutbox).mockResolvedValueOnce('RETRY');
    const adapter = new SimulatedOutboxAdapter({} as Database);
    vi.spyOn(adapter, 'execute').mockRejectedValueOnce(new Error('provider included private@example.test'));
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(processNextOutbox({} as Database, adapter, input, logger)).resolves.toBe(true);
    expect(completeCampaignOutbox).not.toHaveBeenCalled();
    expect(failCampaignOutbox).toHaveBeenCalledWith({} as Database, claimed, policy, now, 'SIMULATED_EXECUTION_FAILED');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private@example.test');
    expect(logger.error).toHaveBeenCalledWith('campaign_outbox_retry_scheduled', {
      outboxId: claimed.id, channel: 'EMAIL', generation: 1, attempt: 1,
      decision: 'RETRY', failedAt: now.toISOString(),
    });
  });

  it('ACKs a durable confirmation after the deterministic timeout without scheduling failure', async () => {
    vi.mocked(claimCampaignOutbox).mockResolvedValueOnce(claimed);
    vi.mocked(authorizeCampaignExecution).mockResolvedValueOnce({
      decision: 'STARTED', channel: 'EMAIL', attemptId: '00000000-0000-4000-8000-000000000003',
      executionId: '00000000-0000-4000-8000-000000000004', startedAt: now,
    });
    vi.mocked(completeCampaignOutbox).mockResolvedValueOnce(true);
    const failCalls = vi.mocked(failCampaignOutbox).mock.calls.length;
    const adapter = new SimulatedOutboxAdapter({} as Database);
    vi.spyOn(adapter, 'execute').mockRejectedValueOnce(
      new SimulatedExecutionError('SIMULATED_TIMEOUT_AFTER_CONFIRMATION'),
    );
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(processNextOutbox({} as Database, adapter, input, logger)).resolves.toBe(true);
    expect(completeCampaignOutbox).toHaveBeenLastCalledWith({} as Database, claimed, now);
    expect(vi.mocked(failCampaignOutbox).mock.calls).toHaveLength(failCalls);
    expect(logger.info).toHaveBeenCalledWith('campaign_outbox_confirmation_reconciled', {
      outboxId: claimed.id, channel: 'EMAIL', generation: 1, attempt: 1,
      decision: 'CONFIRMATION_RECONCILED', reconciledAt: now.toISOString(),
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('private@example.test');
  });

  it('records the final failure as a safe dead-letter decision', async () => {
    const finalClaim = { ...claimed, attempt: policy.maxAttempts };
    vi.mocked(claimCampaignOutbox).mockResolvedValueOnce(finalClaim);
    vi.mocked(authorizeCampaignExecution).mockResolvedValueOnce({
      decision: 'STARTED', channel: 'EMAIL', attemptId: '00000000-0000-4000-8000-000000000003',
      executionId: '00000000-0000-4000-8000-000000000004', startedAt: now,
    });
    vi.mocked(failCampaignOutbox).mockResolvedValueOnce('DEAD_LETTERED');
    const adapter = new SimulatedOutboxAdapter({} as Database);
    vi.spyOn(adapter, 'execute').mockRejectedValueOnce(new Error('contact private@example.test payload secret'));
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(processNextOutbox({} as Database, adapter, input, logger)).resolves.toBe(true);
    expect(logger.error).toHaveBeenCalledWith('campaign_outbox_dead_letter_created', {
      outboxId: claimed.id, channel: 'EMAIL', generation: 1, attempt: policy.maxAttempts,
      decision: 'DEAD_LETTERED', failedAt: now.toISOString(),
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/private@example\.test|payload secret/);
  });
});
