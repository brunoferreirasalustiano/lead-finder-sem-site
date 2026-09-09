import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  new URL('../../../.github/workflows/discovery-pilot.yml', import.meta.url),
  'utf8',
);

describe('bounded discovery pilot workflow', () => {
  it('tolerates a Render cold start using only bounded read-only health requests', () => {
    const readinessStart = workflow.indexOf('- name: Verify hosted HML readiness');
    const preflightStart = workflow.indexOf('- name: Verify collection auth without enqueueing');
    expect(readinessStart).toBeGreaterThan(0);
    expect(preflightStart).toBeGreaterThan(readinessStart);

    const readiness = workflow.slice(readinessStart, preflightStart);
    expect(readiness).toContain('for readiness_attempt in 1 2 3; do');
    expect(readiness).toContain('"$HML_API_URL/health/live"');
    expect(readiness).toContain('"$HML_API_URL/health/ready"');
    expect(readiness).toContain('if [ "$readiness_attempt" -lt 3 ]; then sleep 5; fi');
    expect(readiness).toContain('test "${readiness_ok:-false}" = true');
    expect(readiness).not.toContain('/collect');
    expect(readiness).not.toContain('--data');
    expect(readiness).not.toContain('-X POST');
  });

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
