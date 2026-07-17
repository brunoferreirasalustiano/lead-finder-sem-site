import {
  authorizeCampaignExecution,
  claimCampaignOutbox,
  completeCampaignOutbox,
  failCampaignOutbox,
  type CampaignExecutionPolicy,
  type Database,
} from '@lead-finder/database';
import { SimulatedExecutionError, type SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';
import { correlationForOutbox, type OperationalLogger, type OperationalMetrics, type SafeOperationalReason } from './operational-observability.js';
import type { ShadowModeGuard } from '@lead-finder/shared';

export async function processNextOutbox(
  db: Database,
  adapter: SimulatedOutboxAdapter,
  input: { workerId: string; leaseMs: number; policy: CampaignExecutionPolicy; now?: Date; shadowGuard: ShadowModeGuard; shadowRunId?: string; killSwitchEnabled?: boolean },
  logger: OperationalLogger,
  metrics?: OperationalMetrics,
): Promise<boolean> {
  if (input.killSwitchEnabled) {
    logger.info({ correlationId: 'pilot-kill-switch', event: 'PILOT_KILL_SWITCH_BLOCKED', outcome: 'INELIGIBLE', reason: 'UNKNOWN', durationMs: 0 });
    return false;
  }
  if (!input.shadowGuard || input.shadowGuard.block(input.shadowRunId)) return false;
  const now = input.now ?? new Date();
  const claim = await claimCampaignOutbox(db, {
    workerId: input.workerId,
    leaseMs: input.leaseMs,
    maxAttempts: input.policy.maxAttempts,
    now,
  });
  if (!claim) return false;
  const base = { correlationId: correlationForOutbox(claim.id, claim.deadLetterCycle), outboxId: claim.id,
    workerId: claim.workerId, generation: claim.generation, deadLetterCycle: claim.deadLetterCycle };
  logger.info({ ...base, event: 'campaign_outbox_claimed', outcome: 'CLAIMED' }); metrics?.record('CLAIMED');

  const authorization = await authorizeCampaignExecution(db, claim, input.policy, now);
  if (authorization.decision !== 'STARTED' && authorization.decision !== 'ADMINISTRATIVE') {
    const reason = ('reason' in authorization ? authorization.reason : undefined) as SafeOperationalReason | undefined;
    const outcome = authorization.decision === 'RESCHEDULED' ? 'RESCHEDULED' : authorization.decision === 'INELIGIBLE' ? 'INELIGIBLE' : 'STALE';
    logger.info({ ...base, event: 'campaign_outbox_execution_decided', outcome, reason, durationMs: Date.now() - now.getTime() });
    metrics?.record(outcome, reason, Date.now() - now.getTime());
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
      : { outcome: 'CONFIRMED' as const, replayed: false, reconciled: false };
    if (execution.outcome === 'BLOCKED') {
      logger.info({ ...base, attemptId: authorization.decision === 'STARTED' ? authorization.attemptId : undefined,
        event: 'campaign_outbox_execution_decided', outcome: 'INELIGIBLE', reason: execution.reason,
        durationMs: Date.now() - now.getTime() });
      metrics?.record('INELIGIBLE', execution.reason, Date.now() - now.getTime());
      return true;
    }
    if (execution.reconciled) logger.info({ ...base, attemptId: authorization.decision === 'STARTED' ? authorization.attemptId : undefined, event: 'campaign_outbox_confirmation_reconciled', outcome: 'PUBLISHED', durationMs: Date.now() - now.getTime() });
    const completed = await completeCampaignOutbox(db, claim, input.now ?? new Date());
    const outcome = completed ? 'PUBLISHED' : 'STALE_ACK';
    logger.info({ ...base, attemptId: authorization.decision === 'STARTED' ? authorization.attemptId : undefined, event: completed ? 'campaign_outbox_completed' : 'campaign_outbox_stale_ack', outcome, durationMs: Date.now() - now.getTime() });
    metrics?.record(outcome, undefined, Date.now() - now.getTime());
  } catch (error) {
    const failedAt = input.now ?? new Date();
    const errorCode = error instanceof SimulatedExecutionError ? error.code : 'SIMULATED_EXECUTION_FAILED';
    if (errorCode === 'SIMULATED_TIMEOUT_AFTER_CONFIRMATION') {
      const completed = await completeCampaignOutbox(db, claim, failedAt);
      const outcome = completed ? 'PUBLISHED' : 'STALE';
      logger.info({ ...base, event: completed ? 'campaign_outbox_confirmation_reconciled' : 'campaign_outbox_stale_operation', outcome, durationMs: failedAt.getTime() - now.getTime() });
      metrics?.record(outcome, undefined, failedAt.getTime() - now.getTime());
      return true;
    }
    const decision = await failCampaignOutbox(db, claim, input.policy, failedAt, errorCode);
    const event = errorCode === 'SIMULATED_TIMEOUT_BEFORE_CONFIRMATION'
      ? 'campaign_outbox_timeout_before_confirmation'
      : decision === 'DEAD_LETTERED' ? 'campaign_outbox_dead_letter_created'
        : decision === 'STALE' ? 'campaign_outbox_stale_operation' : 'campaign_outbox_retry_scheduled';
    const outcome = decision === 'DEAD_LETTERED' ? 'DEAD_LETTERED' : decision === 'STALE' ? 'STALE' : 'RETRY';
    logger.error({ ...base, event, outcome, reason: errorCode, durationMs: failedAt.getTime() - now.getTime() });
    metrics?.record(outcome, errorCode, failedAt.getTime() - now.getTime());
  }
  return true;
}
