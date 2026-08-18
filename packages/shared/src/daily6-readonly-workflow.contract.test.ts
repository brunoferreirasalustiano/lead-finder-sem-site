import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../../.github/workflows/daily6-readonly-opportunity-tests.yml', import.meta.url),
  'utf8',
);

describe('Daily-6 read-only opportunity workflow', () => {
  it('is manual-only and never becomes a commercial schedule', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('schedule:');
    expect(workflow).not.toContain('workflow_run:');
    expect(workflow).not.toContain('repository_dispatch:');
  });

  it('keeps all external and sending paths disabled', () => {
    expect(workflow).toContain("DRY_RUN: 'true'");
    expect(workflow).toContain("REAL_SEND_ENABLED: 'false'");
    expect(workflow).toContain("REAL_PROVIDERS_ENABLED: 'false'");
    expect(workflow).toContain("COLLECTION_EGRESS_ENABLED: 'false'");
    expect(workflow).toContain("ENRICHMENT_EGRESS_ENABLED: 'false'");
    expect(workflow).not.toMatch(/POST\s+.*\/(?:collect|internal\/daily6\/run-slot)/i);
    expect(workflow).not.toMatch(/HML_(?:DAILY6|COLLECTION)_TOKEN/);
  });
});
