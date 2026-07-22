import { createHash } from 'node:crypto';
import { z } from 'zod';
export const aiDraftSchema = z.object({
  state: z.literal('LOCAL_SIMULATION'),
  draft: z.string().max(2000),
  fingerprint: z.string().length(64),
  networkCalls: z.literal(0),
});
export const replyClassificationSchema = z.enum([
  'POSITIVE',
  'NEGATIVE',
  'OPT_OUT',
  'INVALID_CONTACT',
  'HUMAN_REVIEW',
]);
export class FakeAiProvider {
  draft(seed: string) {
    const draft = `Rascunho local: ${seed.slice(0, 200)}`;
    return aiDraftSchema.parse({
      state: 'LOCAL_SIMULATION',
      draft,
      fingerprint: createHash('sha256').update(draft).digest('hex'),
      networkCalls: 0,
    });
  }
  classify() {
    return 'HUMAN_REVIEW' as const;
  }
}
