import { createHash } from 'node:crypto';

export interface SimulatedExecution {
  executionId: string;
  replayed: boolean;
}

export class SimulatedOutboxAdapter {
  readonly #executions = new Map<string, string>();

  execute(input: { id: string; idempotencyKey: string; eventType: string; payload: unknown }): Promise<SimulatedExecution> {
    const logicalKey = `${input.id}\0${input.idempotencyKey}\0${input.eventType}`;
    const existing = this.#executions.get(logicalKey);
    if (existing) return Promise.resolve({ executionId: existing, replayed: true });
    const executionId = createHash('sha256')
      .update(`simulated-outbox-v1\0${logicalKey}`)
      .digest('hex');
    this.#executions.set(logicalKey, executionId);
    return Promise.resolve({ executionId, replayed: false });
  }
}
