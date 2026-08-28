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
    expect(workflow).toContain('test "${GITHUB_RUN_ATTEMPT:-1}" = \'1\'');
    expect(workflow).toContain(
      "'7 12 * * *') slot='09'; scheduled_local='09:07:00'; deadline_local='13:00:00'",
    );
    expect(workflow).toContain(
      "'7 16 * * *') slot='13'; scheduled_local='13:07:00'; deadline_local='15:00:00'",
    );
    expect(workflow).toContain(
      "'7 19 * * *') slot='16'; scheduled_local='16:07:00'; deadline_local='20:00:00'",
    );
    expect(workflow).toContain('TZ=America/Sao_Paulo date -d "$date $scheduled_local" +%s');
    expect(workflow).toContain('TZ=America/Sao_Paulo date -d "$date $deadline_local" +%s');
    expect(workflow).toContain('test "$now_epoch" -le "$deadline_epoch"');
    expect(workflow).toContain('echo "deadline_epoch=$deadline_epoch"');
    expect(workflow).toContain('group: daily6-dispatcher');
    expect(workflow).not.toContain('group: daily6-dispatcher-${{');
    expect(workflow).not.toContain('MAX_SCHEDULE_LATENESS_SECONDS');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('scheduled_at:');
    expect(workflow).toContain('correlation_id:');
    expect(workflow).toContain('dispatch_nonce:');
    expect(workflow).toContain('test "$sha" = "$EXPECTED_OPERATIONAL_SHA"');
    expect(workflow).toContain('test "$remote_sha" = "$EXPECTED_SHA"');
    expect(workflow).toContain(
      'EXPECTED_OPERATIONAL_SHA: c21d1cf90317f4f3b74d96cf2a19895ecd1beaf9',
    );
    expect(workflow).toContain('Campinas');
    expect(workflow).toContain('.sent <= 2');
    expect(workflow).not.toContain('backfill');
    expect(workflow).not.toContain('CATCH_UP');
  });

  it('accepts only a dedicated Supabase dispatcher on main and never trusts a caller slot', () => {
    expect(workflow).toContain('test "$GITHUB_ACTOR" = "$SUPABASE_DISPATCH_ACTOR"');
    expect(workflow).toContain('test "$GITHUB_REF" = \'refs/heads/main\'');
    expect(workflow).toContain('test "${SUPABASE_SCHEDULER_ENABLED:-false}" = \'true\'');
    expect(workflow).toContain('test "${GITHUB_SCHEDULE_ENABLED:-true}" != \'true\'');
    expect(workflow).toContain('INPUT_SCHEDULED_AT: ${{ inputs.scheduled_at }}');
    expect(workflow).toContain('INPUT_CORRELATION_ID: ${{ inputs.correlation_id }}');
    expect(workflow).toContain('INPUT_DISPATCH_NONCE: ${{ inputs.dispatch_nonce }}');
    expect(workflow).toContain('TZ=America/Sao_Paulo date -d "@$scheduled_epoch" +%H:%M');
    expect(workflow).not.toContain('INPUT_SLOT');
    expect(workflow).not.toContain('inputs.slot');
    expect(workflow).not.toContain('inputs.request_identity');
  });

  it('atomically claims and terminalizes a Supabase dispatch around all commercial side effects', () => {
    const claimStart = workflow.indexOf('- name: Claim one Supabase scheduler dispatch');
    const enqueueStart = workflow.indexOf('- name: Enqueue one bounded Daily-6 discovery job');
    const finalizeStart = workflow.indexOf('- name: Finalize Supabase scheduler dispatch');
    expect(claimStart).toBeGreaterThanOrEqual(0);
    expect(enqueueStart).toBeGreaterThan(claimStart);
    expect(finalizeStart).toBeGreaterThan(enqueueStart);
    expect(workflow).toContain('claim_daily6_scheduler_dispatch');
    expect(workflow).toContain('test "$claim_result" = \'t\'');
    expect(workflow).toContain('finalize_daily6_scheduler_dispatch');
    expect(workflow).toContain('finalize_result="$(psql');
    expect(workflow).toContain('test "$finalize_result" = \'t\'');
    expect(workflow).toContain("terminal_status='WORKFLOW_FAILED'");
  });

  it('does not log authorization or provider credentials', () => {
    expect(gate).not.toContain('echo "$OPERATIONAL_AUTHORIZATION"');
    expect(gate).not.toContain('echo "$OPERATIONAL_AUTH_EXPIRES_AT"');
    expect(workflow).not.toContain('set -x');
    expect(workflow).not.toContain('echo "$HML_DAILY6_TOKEN"');
  });

  it('rechecks the slot deadline immediately before discovery and send POSTs', () => {
    const collectStart = workflow.indexOf('- name: Enqueue one bounded Daily-6 discovery job');
    const workerStart = workflow.indexOf('- name: Run one bounded discovery and enrichment worker');
    const runSlotStart = workflow.indexOf('- name: Run one authenticated native Daily-6 slot');
    const collect = workflow.slice(collectStart, workerStart);
    const runSlot = workflow.slice(runSlotStart);

    expect(collect).toContain('SLOT_DEADLINE_EPOCH: ${{ steps.slot.outputs.deadline_epoch }}');
    expect(collect).toContain('test "$(date -u +%s)" -le "$SLOT_DEADLINE_EPOCH"');
    expect(collect.indexOf('test "$(date -u +%s)" -le "$SLOT_DEADLINE_EPOCH"')).toBeLessThan(
      collect.indexOf('-X POST "$HML_API_URL/collect"'),
    );
    expect(runSlot).toContain('SLOT_DEADLINE_EPOCH: ${{ steps.slot.outputs.deadline_epoch }}');
    expect(runSlot).toContain('test "$(date -u +%s)" -le "$SLOT_DEADLINE_EPOCH"');
    expect(runSlot.indexOf('test "$(date -u +%s)" -le "$SLOT_DEADLINE_EPOCH"')).toBeLessThan(
      runSlot.indexOf('-X POST "$HML_API_URL/internal/daily6/run-slot"'),
    );
  });

  it('reports only sanitized run-slot HTTP failures without fail-with-body output', () => {
    const runSlotStart = workflow.indexOf('- name: Run one authenticated native Daily-6 slot');
    expect(runSlotStart).toBeGreaterThanOrEqual(0);
    const runSlot = workflow.slice(runSlotStart);
    expect(runSlot).toContain('--output "$response_file"');
    expect(runSlot).toContain("--write-out '%{http_code}'");
    expect(runSlot).toContain('DAILY6_RUN_SLOT_FAILURE_CLASS=NETWORK_OR_TIMEOUT');
    expect(runSlot).toContain('DAILY6_RUN_SLOT_ERROR=$error_summary');
    expect(runSlot).toContain('{code: (.code // null), errorClass: (.errorClass // null)}');
    expect(runSlot).not.toContain('--fail-with-body');
  });

  it('proves the loaded runtime contract once before checking identity or enqueueing', () => {
    const readinessStart = workflow.indexOf('- name: Verify HML readiness');
    const preflightStart = workflow.indexOf('- name: Verify loaded Daily-6 runtime contract');
    const discoveryPreflightStart = workflow.indexOf(
      '- name: Verify dedicated discovery authentication',
    );
    const identityStart = workflow.indexOf('- name: Verify fresh Daily-6 identity');
    const enqueueStart = workflow.indexOf('- name: Enqueue one bounded Daily-6 discovery job');
    const preflight = workflow.slice(preflightStart, discoveryPreflightStart);
    const discoveryPreflight = workflow.slice(discoveryPreflightStart, identityStart);

    expect(readinessStart).toBeGreaterThanOrEqual(0);
    expect(preflightStart).toBeGreaterThan(readinessStart);
    expect(discoveryPreflightStart).toBeGreaterThan(preflightStart);
    expect(identityStart).toBeGreaterThan(discoveryPreflightStart);
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
    expect(preflight).toContain('or .errorClass == "DISCOVERY_AUTH_NOT_READY"');
    expect(preflight).toContain('or .errorClass == "DISCOVERY_AUTH_EXPIRED"');
    expect(preflight).toContain('else "INVALID_RESPONSE"');

    expect(discoveryPreflight).toContain('/internal/discovery/preflight');
    expect(discoveryPreflight).toContain('--get');
    expect(discoveryPreflight).toContain('--max-time 30');
    expect(discoveryPreflight).toContain('Authorization: Bearer $HML_COLLECTION_TOKEN');
    expect(discoveryPreflight).toContain("401) failure_class='AUTH_INVALID_OR_EXPIRED'");
    expect(discoveryPreflight).toContain("403) failure_class='PERMISSION_OR_SOURCE_DENIED'");
    expect(discoveryPreflight).toContain('.discoveryAuth == "PASS"');
    expect(discoveryPreflight).toContain('.collectionPermission == "PASS"');
    expect(discoveryPreflight.match(/curl /g)).toHaveLength(1);
    expect(discoveryPreflight).not.toContain('/collect');
    expect(discoveryPreflight).not.toContain('/internal/daily6/run-slot');
    expect(discoveryPreflight).not.toContain('--fail-with-body');
    expect(discoveryPreflight).not.toContain('cat "$response_file"');
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
    expect(hosted).toContain('EXPECTED_OPERATIONAL_SHA: c21d1cf90317f4f3b74d96cf2a19895ecd1beaf9');
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
    expect(hosted).toContain('or .errorClass == "DISCOVERY_AUTH_NOT_READY"');
    expect(hosted).toContain('or .errorClass == "DISCOVERY_AUTH_EXPIRED"');
    expect(hosted).toContain('else "INVALID_RESPONSE"');
  });
});

describe('Daily-6 hosted discovery authentication preflight workflow', () => {
  it('is manual-only, read-only, single-request and output-sanitized', async () => {
    const hosted = await readFile(
      new URL('../../../.github/workflows/daily6-discovery-preflight.yml', import.meta.url),
      'utf8',
    );

    expect(hosted).toContain('workflow_dispatch:');
    expect(hosted).not.toContain('schedule:');
    expect(hosted).not.toContain('push:');
    expect(hosted).not.toContain('pull_request:');
    expect(hosted).toContain('contents: read');
    expect(hosted).toContain('/internal/discovery/preflight');
    expect(hosted.match(/curl /g)).toHaveLength(1);
    expect(hosted).toContain('--get');
    expect(hosted).toContain('Authorization: Bearer $HML_COLLECTION_TOKEN');
    expect(hosted).not.toContain('/collect');
    expect(hosted).not.toContain('/internal/daily6/run-slot');
    expect(hosted).not.toContain('provider');
    expect(hosted).not.toContain('gmail');
    expect(hosted).not.toContain('artifact');
    expect(hosted).not.toContain('set -x');
    expect(hosted).not.toContain('cat "$response_file"');
    expect(hosted).toContain("401) error_class='AUTH_INVALID_OR_EXPIRED'");
    expect(hosted).toContain('STATUS=DISCOVERY_AUTH_PREFLIGHT_PASS');
  });
});
