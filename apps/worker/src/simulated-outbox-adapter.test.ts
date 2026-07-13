import { describe, expect, it } from 'vitest';
import { SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';

describe('SimulatedOutboxAdapter', () => {
  it('is deterministic and idempotent without inspecting or emitting payload data', async () => {
    const adapter = new SimulatedOutboxAdapter();
    const first = await adapter.execute({ id: 'outbox-1', idempotencyKey: 'event-1', eventType: 'ATTEMPT_CREATED', payload: { secret: 'a' } });
    const replay = await adapter.execute({ id: 'outbox-1', idempotencyKey: 'event-1', eventType: 'ATTEMPT_CREATED', payload: { secret: 'b' } });
    expect(replay).toEqual({ executionId: first.executionId, replayed: true });
    expect(first.executionId).toMatch(/^[a-f0-9]{64}$/);
  });
});
