import {
  acquireProcessorLeadership, authorizeCampaignExecution, claimCampaignOutbox,
  completeCampaignOutbox, confirmSimulatedCampaignExecution, failCampaignOutbox,
  renewProcessorLeadership, reserveDailyLeadAllocation, type CampaignExecutionPolicy, type Database, type ExecutionSource,
} from '@lead-finder/database';

export interface LeadBatchReport {
  executionSource: ExecutionSource;
  outcome: 'COMPLETED' | 'STANDBY' | 'TIME_BUDGET_EXHAUSTED';
  attempted: number;
  processed: number;
  durationMs: number;
}

export function createDryRunItemProcessor(input: {
  db: Database; workerId: string; leaseMs: number; dailyLimit: number;
  executionSource: ExecutionSource; policy: CampaignExecutionPolicy; now?: () => Date;
}) {
  return async (): Promise<boolean> => {
    const now = input.now?.() ?? new Date();
    if (!Number.isFinite(now.getTime())) throw new RangeError('now must return a valid date');
    const claim = await claimCampaignOutbox(input.db, {
      workerId: input.workerId, leaseMs: input.leaseMs, maxAttempts: input.policy.maxAttempts, now,
    });
    if (!claim) return false;
    const quota = await reserveDailyLeadAllocation(input.db, claim, {
      source: input.executionSource, configuredLimit: input.dailyLimit, now,
    });
    if (quota === 'LIMIT_REACHED') return false;
    const authorization = await authorizeCampaignExecution(input.db, claim, input.policy, now);
    if (authorization.decision !== 'STARTED' && authorization.decision !== 'ADMINISTRATIVE') return true;
    try {
      if (authorization.decision === 'STARTED') {
        const confirmation = await confirmSimulatedCampaignExecution(input.db, {
          executionId: authorization.executionId, outboxId: claim.id, cycle: claim.deadLetterCycle,
          attemptId: authorization.attemptId, channel: authorization.channel, workerId: claim.workerId,
          token: claim.token, generation: claim.generation, confirmedAt: now,
        });
        if (confirmation.outcome === 'BLOCKED') return true;
      }
      await completeCampaignOutbox(input.db, claim, now);
    } catch {
      await failCampaignOutbox(input.db, claim, input.policy, now, 'SIMULATED_EXECUTION_FAILED');
    }
    return true;
  };
}

export async function processLeadBatch(input: {
  db: Database;
  batchSize: number;
  timeBudgetMs: number;
  dailyLimit: number;
  dryRun: true;
  executionSource: ExecutionSource;
  executorId: string;
  processorRole: 'primary' | 'standby';
  leadershipLeaseMs: number;
  processOne: () => Promise<boolean>;
  acquireLeadership?: typeof acquireProcessorLeadership;
  renewLeadership?: typeof renewProcessorLeadership;
  now?: () => number;
}): Promise<LeadBatchReport> {
  const startedAt = (input.now ?? Date.now)();
  if (input.processorRole !== 'primary') return { executionSource: input.executionSource, outcome: 'STANDBY', attempted: 0, processed: 0, durationMs: 0 };
  const leadership = await (input.acquireLeadership ?? acquireProcessorLeadership)(input.db, {
    source: input.executionSource, executorId: input.executorId, leaseMs: input.leadershipLeaseMs,
  });
  if (!leadership.acquired) return { executionSource: input.executionSource, outcome: 'STANDBY', attempted: 0, processed: 0, durationMs: (input.now ?? Date.now)() - startedAt };
  let attempted = 0;
  let processed = 0;
  while (attempted < Math.min(input.batchSize, 10)) {
    if ((input.now ?? Date.now)() - startedAt >= input.timeBudgetMs) break;
    if (!leadership.token || leadership.generation === undefined || !await (input.renewLeadership ?? renewProcessorLeadership)(input.db, {
      source: input.executionSource, executorId: input.executorId, token: leadership.token,
      generation: leadership.generation, leaseMs: input.leadershipLeaseMs,
    })) break;
    attempted += 1;
    if (!await input.processOne()) break;
    processed += 1;
  }
  const durationMs = (input.now ?? Date.now)() - startedAt;
  return { executionSource: input.executionSource,
    outcome: durationMs >= input.timeBudgetMs ? 'TIME_BUDGET_EXHAUSTED' : 'COMPLETED',
    attempted, processed, durationMs };
}
