import { confirmSimulatedCampaignExecution, type Database } from '@lead-finder/database';

export interface SimulatedExecution {
  executionId: string;
  replayed: boolean;
  reconciled: boolean;
}

export type SimulatedFault = 'NONE' | 'TIMEOUT_BEFORE_CONFIRMATION' | 'TIMEOUT_AFTER_CONFIRMATION';
export class SimulatedExecutionError extends Error {
  constructor(readonly code: 'SIMULATED_TIMEOUT_BEFORE_CONFIRMATION' | 'SIMULATED_TIMEOUT_AFTER_CONFIRMATION') { super(code); }
}

export class SimulatedOutboxAdapter {
  constructor(private readonly db: Database, private readonly fault: SimulatedFault = 'NONE') {}

  async execute(input: { id: string; deadLetterCycle: number; executionId: string; attemptId?: string; channel: string }): Promise<SimulatedExecution> {
    if (this.fault === 'TIMEOUT_BEFORE_CONFIRMATION') {
      throw new SimulatedExecutionError('SIMULATED_TIMEOUT_BEFORE_CONFIRMATION');
    }
    const confirmation = await confirmSimulatedCampaignExecution(this.db, {
      executionId: input.executionId, outboxId: input.id, cycle: input.deadLetterCycle,
      ...(input.attemptId ? { attemptId: input.attemptId } : {}), channel: input.channel,
    });
    if (this.fault === 'TIMEOUT_AFTER_CONFIRMATION' && !confirmation.replayed) {
      throw new SimulatedExecutionError('SIMULATED_TIMEOUT_AFTER_CONFIRMATION');
    }
    return { ...confirmation, reconciled: confirmation.replayed };
  }
}
