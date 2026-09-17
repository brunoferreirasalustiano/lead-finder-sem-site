import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('./enrichment.ts', import.meta.url), 'utf8');

describe('legacy website recheck claim', () => {
  it('serializes the claim and commits a single fail-closed marker', () => {
    const claim = source.slice(
      source.indexOf('export async function claimLegacyWebsiteRecheck'),
      source.indexOf('export async function recordLeadEnrichment'),
    );
    expect(claim).toContain("for('update')");
    expect(claim).toContain("eq(leadEvidence.evidenceType, 'WEBSITE')");
    expect(claim).toContain('desc(leadEvidence.observedAt)');
    expect(claim).toContain("latest?.source !== LEGACY_WEBSITE_SOURCE");
    expect(claim).toContain("source: LEGACY_RECHECK_MARKER_SOURCE");
    expect(claim).toContain("result: 'UNKNOWN'");
    expect(claim).toContain('onConflictDoNothing');
    expect(claim).toContain('return inserted.length === 1');
  });
});
