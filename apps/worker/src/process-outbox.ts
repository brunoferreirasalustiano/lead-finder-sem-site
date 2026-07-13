import { claimCampaignOutbox, completeCampaignOutbox, type Database } from '@lead-finder/database';
import type { SimulatedOutboxAdapter } from './simulated-outbox-adapter.js';

export interface OperationalLogger {
  info(event: string, metadata: Record<string, string | number | boolean>): void;
  error(event: string, metadata: Record<string, string | number | boolean>): void;
}

export async function processNextOutbox(
  db: Database,
  adapter: SimulatedOutboxAdapter,
  input: { workerId: string; leaseMs: number; now?: Date },
  logger: OperationalLogger,
): Promise<boolean> {
  const claim = await claimCampaignOutbox(db, input);
  if (!claim) return false;
  logger.info('campaign_outbox_claimed', { outboxId: claim.id, generation: claim.generation });
  try {
    const execution = await adapter.execute(claim);
    const completed = await completeCampaignOutbox(db, claim, input.now ?? new Date());
    logger.info(completed ? 'campaign_outbox_completed' : 'campaign_outbox_stale_ack', {
      outboxId: claim.id, generation: claim.generation, replayed: execution.replayed,
    });
  } catch {
    logger.error('campaign_outbox_processing_failed', { outboxId: claim.id, generation: claim.generation });
  }
  return true;
}
