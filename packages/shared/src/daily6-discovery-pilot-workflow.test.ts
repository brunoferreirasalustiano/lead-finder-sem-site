import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  new URL('../../../.github/workflows/discovery-pilot.yml', import.meta.url),
  'utf8',
);

describe('bounded discovery pilot workflow', () => {
  it('pins the approved HML SHA and uses the read-only discovery preflight before enqueue', () => {
    expect(workflow).toContain(
      'APPROVED_OPERATIONAL_SHA: 707644eabc6a69ba299ba61e688ee5376dccd767',
    );

    const preflightStart = workflow.indexOf('- name: Verify collection auth without enqueueing');
    const setupStart = workflow.indexOf('- uses: actions/setup-node@v4');
    expect(preflightStart).toBeGreaterThan(0);
    expect(setupStart).toBeGreaterThan(preflightStart);

    const preflight = workflow.slice(preflightStart, setupStart);
    expect(preflight).toContain('--get "$HML_API_URL/internal/discovery/preflight"');
    expect(preflight).toContain('Authorization: Bearer $HML_COLLECTION_TOKEN');
    expect(preflight).toContain('DISCOVERY_AUTH=PASS');
    expect(preflight).toContain('COLLECTION_PERMISSION=PASS');
    expect(preflight).toContain('ERROR_CLASS=NETWORK_OR_TIMEOUT');
    expect(preflight).not.toContain('/collect');
    expect(preflight).not.toContain('--data');
    expect(preflight).not.toContain('cat "$response_file"');
  });

  it('keeps the mutating enqueue after the read-only preflight', () => {
    const preflightStart = workflow.indexOf('- name: Verify collection auth without enqueueing');
    const enqueueStart = workflow.indexOf('- name: Enqueue one idempotent collection request');
    expect(enqueueStart).toBeGreaterThan(preflightStart);
    expect(workflow.slice(preflightStart, enqueueStart)).not.toContain('/collect');
  });
});
