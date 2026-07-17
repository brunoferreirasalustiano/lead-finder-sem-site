import { describe, expect, it } from 'vitest';
import { evaluateSyntheticBatch, loadSyntheticBatch, materializeSyntheticBatch } from './pilot-real-synthetic-batch.js';

describe('20-lead controlled-pilot synthetic batch', () => {
  it('covers all required exclusions without any external effect', async () => {
    const summary = evaluateSyntheticBatch(await loadSyntheticBatch());
    expect(summary).toMatchObject({ inputCount: 20, eligibleCount: 10, externalEffects: 0 });
    expect(summary.rejectedByReason).toMatchObject({
      BLOCKED: 1, OPT_OUT: 1, NAO_CONTATAR: 1, DUPLICATE_EXACT: 1, DUPLICATE_NORMALIZED: 1,
      REGION_MISMATCH: 1, CATEGORY_MISMATCH: 1, INVALID_CONTACT: 1, CONTACT_ABSENT: 1, CONFIRMED_SITE: 1,
    });
  });

  it('is deterministic and does not create duplicate resources on rerun', async () => {
    const summary = evaluateSyntheticBatch(await loadSyntheticBatch());
    const first = materializeSyntheticBatch(summary);
    const second = materializeSyntheticBatch(summary, new Set(first.resourceIds));
    expect(first.createdResourceIds).toHaveLength(10);
    expect(second.createdResourceIds).toEqual([]);
    expect(second.resourceIds).toEqual(first.resourceIds);
  });
});
