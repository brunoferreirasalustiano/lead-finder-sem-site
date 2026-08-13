import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  new URL('../../../.github/workflows/daily6-dispatcher.yml', import.meta.url),
  'utf8',
);

const gateStart = workflow.indexOf('- name: Verify Daily-6 operational authorization gate');
const postStart = workflow.indexOf('- name: Run one authenticated native Daily-6 slot');
const gate = workflow.slice(gateStart, postStart);

describe('native Daily-6 scheduler authorization gate', () => {
  it('blocks a scheduled run without the explicit versioned authorization before POST', () => {
    expect(gateStart).toBeGreaterThanOrEqual(0);
    expect(postStart).toBeGreaterThan(gateStart);
    expect(gate).toContain(
      'OPERATIONAL_AUTHORIZATION: ${{ vars.DAILY6_OPERATIONAL_AUTHORIZATION }}',
    );
    expect(gate).toContain(
      'OPERATIONAL_AUTH_EXPIRES_AT: ${{ vars.DAILY6_OPERATIONAL_AUTH_EXPIRES_AT }}',
    );
    expect(gate).toContain(
      'test "$OPERATIONAL_AUTHORIZATION" = \'DAILY6_NATIVE_SEND_AUTHORIZED_V1\'',
    );
    expect(gate).toContain('test "$expires_epoch" -gt "$now_epoch"');
    expect(gate).toContain('exit 1');
    expect(gate).not.toContain('/internal/daily6/run-slot');
  });

  it('preserves the legitimate authorized path and existing schedule invariants', () => {
    expect(gate).toContain('DAILY6_NATIVE_SEND_AUTHORIZED_V1');
    expect(workflow).toContain("cron: '0 12 * * *'");
    expect(workflow).toContain("cron: '0 16 * * *'");
    expect(workflow).toContain("cron: '0 19 * * *'");
    expect(workflow).toContain('test "$date" = "$today"');
    expect(workflow).toContain('[[ "$slot" =~ ^(09|13|16)$ ]]');
    expect(workflow).toContain('test "$sha" = "$EXPECTED_OPERATIONAL_SHA"');
    expect(workflow).toContain('test "$remote_sha" = "$EXPECTED_SHA"');
    expect(workflow).toContain('Campinas');
    expect(workflow).toContain('.sent <= 2');
    expect(workflow).not.toContain('backfill');
    expect(workflow).not.toContain('CATCH_UP');
  });

  it('does not log authorization or provider credentials', () => {
    expect(gate).not.toContain('echo "$OPERATIONAL_AUTHORIZATION"');
    expect(gate).not.toContain('echo "$OPERATIONAL_AUTH_EXPIRES_AT"');
    expect(workflow).not.toContain('set -x');
    expect(workflow).not.toContain('echo "$HML_DAILY6_TOKEN"');
  });
});
