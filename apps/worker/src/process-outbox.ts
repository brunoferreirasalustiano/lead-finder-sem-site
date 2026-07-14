import {
  authorizeCampaignExecution,
  claimCampaignOutbox,
  completeCampaignOutbox,
  failCampaignOutbox,
  type CampaignExecutionPolicy,
  type Database,
} from '@lead-finder/database';
import type { SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';

export interface OperationalLogger {
  info(event: string, metadata: Record<string, string | number | boolean>): void;
  error(event: string, metadata: Record<string, string | number | boolean>): void;
}

export async function processNextOutbox(
  db: Database,
  adapter: SimulatedOutboxAdapter,
  input: { workerId: string; leaseMs: number; policy: CampaignExecutionPolicy; now?: Date },
  logger: OperationalLogger,
): Promise<boolean> {
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
    const execution = await adapter.execute(claim);
    const completed = await completeCampaignOutbox(db, claim, input.now ?? new Date());
    logger.info(completed ? 'campaign_outbox_completed' : 'campaign_outbox_stale_ack', {
      outboxId: claim.id, channel, generation: claim.generation, attempt: claim.attempt,
      decision: completed ? 'COMPLETED' : 'STALE_ACK', replayed: execution.replayed,
      completedAt: (input.now ?? new Date()).toISOString(),
    });
  } catch {
    const failedAt = input.now ?? new Date();
    const decision = await failCampaignOutbox(db, claim, input.policy, failedAt);
    logger.error('campaign_outbox_processing_failed', {
      outboxId: claim.id, channel, generation: claim.generation, attempt: claim.attempt,
      decision, failedAt: failedAt.toISOString(),
    });
  }
  return true;
}
