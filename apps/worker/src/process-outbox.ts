import {
  authorizeCampaignExecution,
  claimCampaignOutbox,
  completeCampaignOutbox,
  failCampaignOutbox,
  type CampaignExecutionPolicy,
  type Database,
} from '@lead-finder/database';
import { SimulatedExecutionError, type SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';
import type { ShadowModeGuard } from '@lead-finder/shared';

export interface OperationalLogger {
  info(event: string, metadata: Record<string, string | number | boolean>): void;
  error(event: string, metadata: Record<string, string | number | boolean>): void;
}

export async function processNextOutbox(
  db: Database,
  adapter: SimulatedOutboxAdapter,
  input: { workerId: string; leaseMs: number; policy: CampaignExecutionPolicy; now?: Date; shadowGuard?: ShadowModeGuard; shadowRunId?: string },
  logger: OperationalLogger,
): Promise<boolean> {
  if (input.shadowGuard?.block(input.shadowRunId)) return false;
  const now = input.now ?? new Date();
  const claim = await claimCampaignOutbox(db, {
    workerId: input.workerId,
    leaseMs: input.leaseMs,
    maxAttempts: input.policy.maxAttempts,
    now,
  });
  if (!claim) return false;
  logger.info('campaign_outbox_claimed', {
    outboxId: claim.id, generation: claim.generation, attempt: claim.attempt, claimedAt: now.toISOString(),
  });

  const authorization = await authorizeCampaignExecution(db, claim, input.policy, now);
  if (authorization.decision !== 'STARTED' && authorization.decision !== 'ADMINISTRATIVE') {
    const metadata: Record<string, string | number | boolean> = {
      outboxId: claim.id, generation: claim.generation, attempt: claim.attempt,
      decision: authorization.decision, decidedAt: now.toISOString(),
    };
    if ('channel' in authorization) metadata['channel'] = authorization.channel;
    if ('reason' in authorization) metadata['reason'] = authorization.reason;
    if ('availableAt' in authorization) metadata['availableAt'] = authorization.availableAt.toISOString();
    logger.info('campaign_outbox_execution_decided', metadata);
    return true;
  }

  const channel = authorization.decision === 'STARTED' ? authorization.channel : 'ADMINISTRATIVE';
  try {
    const execution = authorization.decision === 'STARTED'
      ? await adapter.execute({
        id: claim.id, deadLetterCycle: claim.deadLetterCycle, executionId: authorization.executionId,
        attemptId: authorization.attemptId, channel, workerId: claim.workerId,
        token: claim.token, generation: claim.generation,
        ...(input.now ? { confirmedAt: input.now } : {}),
      })
      : { replayed: false, reconciled: false };
    if (execution.reconciled) logger.info('campaign_outbox_confirmation_reconciled', {
      outboxId: claim.id, channel, generation: claim.generation, attempt: claim.attempt,
      decision: 'CONFIRMATION_RECONCILED', reconciledAt: (input.now ?? new Date()).toISOString(),
    });
    const completed = await completeCampaignOutbox(db, claim, input.now ?? new Date());
    logger.info(completed ? 'campaign_outbox_completed' : 'campaign_outbox_stale_ack', {
      outboxId: claim.id, channel, generation: claim.generation, attempt: claim.attempt,
      decision: completed ? 'COMPLETED' : 'STALE_ACK', replayed: execution.replayed,
      completedAt: (input.now ?? new Date()).toISOString(),
    });
  } catch (error) {
    const failedAt = input.now ?? new Date();
    const errorCode = error instanceof SimulatedExecutionError ? error.code : 'SIMULATED_EXECUTION_FAILED';
    if (errorCode === 'SIMULATED_TIMEOUT_AFTER_CONFIRMATION') {
      const completed = await completeCampaignOutbox(db, claim, failedAt);
      logger.info(completed ? 'campaign_outbox_confirmation_reconciled' : 'campaign_outbox_stale_operation', {
        outboxId: claim.id, channel, generation: claim.generation, attempt: claim.attempt,
        decision: completed ? 'CONFIRMATION_RECONCILED' : 'STALE', reconciledAt: failedAt.toISOString(),
      });
      return true;
    }
    const decision = await failCampaignOutbox(db, claim, input.policy, failedAt, errorCode);
    const event = errorCode === 'SIMULATED_TIMEOUT_BEFORE_CONFIRMATION'
      ? 'campaign_outbox_timeout_before_confirmation'
      : decision === 'DEAD_LETTERED' ? 'campaign_outbox_dead_letter_created'
        : decision === 'STALE' ? 'campaign_outbox_stale_operation' : 'campaign_outbox_retry_scheduled';
    logger.error(event, {
      outboxId: claim.id, channel, generation: claim.generation, attempt: claim.attempt,
      decision, failedAt: failedAt.toISOString(),
    });
  }
  return true;
}
