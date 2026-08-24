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
    expect(workflow).toContain("cron: '7 12 * * *'");
    expect(workflow).toContain("cron: '7 16 * * *'");
    expect(workflow).toContain("cron: '7 19 * * *'");
    expect(workflow).toContain('test "$date" = "$today"');
    expect(workflow).toContain('[[ "$slot" =~ ^(09|13|16)$ ]]');
    expect(workflow).toContain("test \"${GITHUB_RUN_ATTEMPT:-1}\" = '1'");
    expect(workflow).toContain("MAX_SCHEDULE_LATENESS_SECONDS: '3600'");
    expect(workflow).toContain('test "$lateness_seconds" -le "$MAX_SCHEDULE_LATENESS_SECONDS"');
    expect(workflow).toContain("format('{0}|{1}', inputs.date, inputs.slot)");
    expect(workflow).toContain('test "$sha" = "$EXPECTED_OPERATIONAL_SHA"');
    expect(workflow).toContain('test "$remote_sha" = "$EXPECTED_SHA"');
    expect(workflow).toContain('default: bab3a610e9c9588ecb8b95f0ecbc7114f1e0a892');
    expect(workflow).toContain('EXPECTED_OPERATIONAL_SHA: bab3a610e9c9588ecb8b95f0ecbc7114f1e0a892');
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

  it('reports only sanitized run-slot HTTP failures without fail-with-body output', () => {
    const runSlotStart = workflow.indexOf('- name: Run one authenticated native Daily-6 slot');
    expect(runSlotStart).toBeGreaterThanOrEqual(0);
    const runSlot = workflow.slice(runSlotStart);
    expect(runSlot).toContain('--output "$response_file"');
    expect(runSlot).toContain("--write-out '%{http_code}'");
    expect(runSlot).toContain("DAILY6_RUN_SLOT_FAILURE_CLASS=NETWORK_OR_TIMEOUT");
    expect(runSlot).toContain("DAILY6_RUN_SLOT_ERROR=$error_summary");
    expect(runSlot).toContain("{code: (.code // null), errorClass: (.errorClass // null)}");
    expect(runSlot).not.toContain('--fail-with-body');
  });

  it('proves the loaded runtime contract once before checking identity or enqueueing', () => {
    const readinessStart = workflow.indexOf('- name: Verify HML readiness');
    const preflightStart = workflow.indexOf('- name: Verify loaded Daily-6 runtime contract');
    const identityStart = workflow.indexOf('- name: Verify fresh Daily-6 identity');
    const enqueueStart = workflow.indexOf('- name: Enqueue one bounded Daily-6 discovery job');
    const preflight = workflow.slice(preflightStart, identityStart);

    expect(readinessStart).toBeGreaterThanOrEqual(0);
    expect(preflightStart).toBeGreaterThan(readinessStart);
    expect(identityStart).toBeGreaterThan(preflightStart);
    expect(enqueueStart).toBeGreaterThan(identityStart);
    expect(preflight).toContain('/internal/daily6/runtime-preflight');
    expect(preflight).toContain('--get');
    expect(preflight).toContain('--max-time 30');
    expect(preflight).toContain('expectedOperationalSha=$EXPECTED_SHA');
    expect(preflight).toContain('Authorization: Bearer $HML_DAILY6_TOKEN');
    expect(preflight).toContain('.runtimeConfigured == true');
    expect(preflight).toContain('.operationalShaMatch == true');
    expect(preflight).toContain('.daily6RuntimeReady == true');
    expect(preflight.match(/curl /g)).toHaveLength(1);
    expect(preflight).not.toContain('/collect');
    expect(preflight).not.toContain('/internal/daily6/run-slot');
    expect(preflight).not.toContain('--fail-with-body');
    expect(preflight).not.toContain('cat "$response_file"');
    expect(preflight).toContain('or .errorClass == "RUNTIME_NOT_READY"');
    expect(preflight).toContain('else "INVALID_RESPONSE"');
  });
});

describe('Daily-6 hosted runtime preflight workflow', () => {
  it('is manual-only, read-only, single-request and output-sanitized', async () => {
    const hosted = await readFile(
      new URL('../../../.github/workflows/daily6-runtime-preflight.yml', import.meta.url),
      'utf8',
    );

    expect(hosted).toContain('workflow_dispatch:');
    expect(hosted).not.toContain('schedule:');
    expect(hosted).not.toContain('push:');
    expect(hosted).not.toContain('pull_request:');
    expect(hosted).toContain('contents: read');
    expect(hosted).toContain(
      'EXPECTED_OPERATIONAL_SHA: bab3a610e9c9588ecb8b95f0ecbc7114f1e0a892',
    );
    expect(hosted).toContain('/internal/daily6/runtime-preflight');
    expect(hosted.match(/curl /g)).toHaveLength(1);
    expect(hosted).toContain('--get');
    expect(hosted).toContain('Cache-Control');
    expect(hosted).not.toContain('/collect');
    expect(hosted).not.toContain('/internal/daily6/run-slot');
    expect(hosted).not.toContain('provider');
    expect(hosted).not.toContain('gmail');
    expect(hosted).not.toContain('artifact');
    expect(hosted).not.toContain('set -x');
    expect(hosted).not.toContain('cat "$response_file"');
    expect(hosted).toContain('else "INVALID_RESPONSE"');
  });
});
