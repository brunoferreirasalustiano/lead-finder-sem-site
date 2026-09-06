import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  new URL('../../../.github/workflows/daily6-dispatcher.yml', import.meta.url),
  'utf8',
);

describe('native Daily-6 scheduler control plane', () => {
  it('runs from the default-branch schedule with an immutable HML pin', () => {
    expect(workflow).toContain("cron: '7 12 * * *'");
    expect(workflow).toContain("cron: '7 16 * * *'");
    expect(workflow).toContain("cron: '7 19 * * *'");
    expect(workflow).toContain('HML_BRANCH: hml/render-supabase-plan-b');
    expect(workflow).toContain(
      'EXPECTED_OPERATIONAL_SHA: 707644eabc6a69ba299ba61e688ee5376dccd767',
    );
    expect(workflow).toContain('test "$remote_sha" = "$EXPECTED_SHA"');
  });

  it('builds the discovery worker from the exact approved HML SHA', () => {
    const checkoutStart = workflow.indexOf('- name: Checkout exact approved HML worker source');
    const buildStart = workflow.indexOf('- name: Build the bounded discovery worker');
    const configStart = workflow.indexOf(
      '- name: Validate bounded discovery worker configuration before enqueue',
    );
    const databaseIdentityStart = workflow.indexOf(
      '- name: Validate bounded worker database identity before enqueue',
    );
    const enqueueStart = workflow.indexOf('- name: Enqueue one bounded Daily-6 discovery job');
    const workerStart = workflow.indexOf('- name: Run one bounded discovery and enrichment worker');
    expect(checkoutStart).toBeGreaterThanOrEqual(0);
    expect(buildStart).toBeGreaterThan(checkoutStart);
    expect(configStart).toBeGreaterThan(buildStart);
    expect(enqueueStart).toBeGreaterThan(configStart);
    expect(databaseIdentityStart).toBeGreaterThan(configStart);
    expect(enqueueStart).toBeGreaterThan(databaseIdentityStart);
    expect(workerStart).toBeGreaterThan(buildStart);
    const build = workflow.slice(checkoutStart, workerStart);
    expect(build).toContain('ref: ${{ env.EXPECTED_OPERATIONAL_SHA }}');
    expect(build).toContain('path: hml-worker');
    expect(build).toContain('working-directory: hml-worker');
    expect(workflow).toContain('node hml-worker/apps/worker/dist/index.js');
  });

  it('fails before collection enqueue when the exact worker config is invalid', () => {
    const configStart = workflow.indexOf(
      '- name: Validate bounded discovery worker configuration before enqueue',
    );
    const databaseIdentityStart = workflow.indexOf(
      '- name: Validate bounded worker database identity before enqueue',
    );
    const enqueueStart = workflow.indexOf('- name: Enqueue one bounded Daily-6 discovery job');
    const config = workflow.slice(configStart, databaseIdentityStart);
    expect(configStart).toBeGreaterThanOrEqual(0);
    expect(enqueueStart).toBeGreaterThan(configStart);
    expect(config).toContain('parseWorkerConfig');
    expect(config).toContain('packages/shared/dist/config.js');
    expect(config).toContain('DISCOVERY_WORKER_CONFIG=FAIL');
    expect(config).toContain('DISCOVERY_WORKER_CONFIG_FAILURE_CLASS=INVALID_CONFIGURATION');
    expect(config).toContain('REQUEST_IDENTITY: ${{ steps.discovery.outputs.request_identity }}');
    expect(config).not.toContain('curl');
    expect(config).not.toContain('psql');
    const databaseIdentity = workflow.slice(databaseIdentityStart, enqueueStart);
    expect(databaseIdentity).toContain('default_transaction_read_only=on');
    expect(databaseIdentity).toContain('select current_user');
    expect(databaseIdentity).toContain('lead_finder_discovery_runtime');
    expect(databaseIdentity).toContain('DISCOVERY_DATABASE_IDENTITY=PASS');
    expect(databaseIdentity).not.toContain('echo "$database_user"');
  });

  it('proves dedicated discovery auth with one read-only GET before identity and enqueue', () => {
    const runtimePreflightStart = workflow.indexOf(
      '- name: Verify loaded Daily-6 runtime contract',
    );
    const discoveryPreflightStart = workflow.indexOf(
      '- name: Verify dedicated discovery authentication',
    );
    const identityStart = workflow.indexOf('- name: Verify fresh Daily-6 identity');
    const enqueueStart = workflow.indexOf('- name: Enqueue one bounded Daily-6 discovery job');
    const discoveryPreflight = workflow.slice(discoveryPreflightStart, identityStart);

    expect(discoveryPreflightStart).toBeGreaterThan(runtimePreflightStart);
    expect(identityStart).toBeGreaterThan(discoveryPreflightStart);
    expect(enqueueStart).toBeGreaterThan(identityStart);
    expect(discoveryPreflight).toContain('/internal/discovery/preflight');
    expect(discoveryPreflight).toContain('--get');
    expect(discoveryPreflight.match(/curl /g)).toHaveLength(1);
    expect(discoveryPreflight).toContain('Authorization: Bearer $HML_COLLECTION_TOKEN');
    expect(discoveryPreflight).toContain('DISCOVERY_AUTH_PREFLIGHT=PASS');
    expect(discoveryPreflight).not.toContain('/collect');
    expect(discoveryPreflight).not.toContain('psql');
    expect(discoveryPreflight).not.toContain('cat "$response_file"');
  });

  it('surfaces only sanitized worker failure classification', () => {
    const start = workflow.indexOf('- name: Run one bounded discovery and enrichment worker');
    const end = workflow.indexOf('- name: Require terminal collection before selection');
    const worker = workflow.slice(start, end);
    expect(worker).toContain('DISCOVERY_WORKER_EXIT_CODE=');
    expect(worker).toContain('DISCOVERY_WORKER_FAILURE_CLASS=');
    expect(worker).toContain("worker_failure_class='UNKNOWN'");
    expect(worker).toContain('worker_startup_blocked');
    expect(worker).toContain('collection_source_failure');
    expect(worker).toContain('worker_fatal');
    expect(worker).toContain('COLLECTION_LEASE_LOST');
    expect(worker).toContain('NO_COLLECTION_JOB_CLAIMED');
    expect(worker).toContain('REQUEST_IDENTITY: ${{ steps.discovery.outputs.request_identity }}');
    expect(worker).not.toContain('cat "$worker_log"');
    expect(worker).not.toContain('printf \'%s\' "$worker_log"');
  });

  it('pins the native scope and hard slot quota without slot replay', () => {
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
    expect(workflow).toContain('test "$now_epoch" -le "$deadline_epoch"');
    expect(workflow).toContain('group: daily6-dispatcher');
    expect(workflow).not.toContain('MAX_SCHEDULE_LATENESS_SECONDS');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('INPUT_SCHEDULED_AT: ${{ inputs.scheduled_at }}');
    expect(workflow).toContain('INPUT_CORRELATION_ID: ${{ inputs.correlation_id }}');
    expect(workflow).toContain('INPUT_DISPATCH_NONCE: ${{ inputs.dispatch_nonce }}');
    expect(workflow).toContain('claim_daily6_scheduler_dispatch');
    expect(workflow).toContain('finalize_daily6_scheduler_dispatch');
    expect(workflow).toContain('test "$finalize_result" = \'t\'');
    expect(workflow).not.toContain('inputs.slot');
    expect(workflow).not.toContain('inputs.request_identity');
    expect(workflow).toContain('Campinas');
    expect(workflow).toContain('.sent <= 2');
    expect(workflow).toContain('HML_COLLECTION_TOKEN');
    expect(workflow).toContain('HML_DATABASE_URL');
    expect(workflow).toContain('DISCOVERY_EXECUTED=true');
    expect(workflow).toContain('DISCOVERY_TERMINAL_STATUS=COMPLETED');
    expect(workflow).toContain('collection_jobs');
    expect(workflow).toContain('lead_finder_internal.daily6_batch_identity_exists');
    expect(workflow).toContain('test "$existing_batch_count" = \'f\'');
    expect(workflow).not.toContain('select count(*) from public.daily6_batches');
    expect(workflow).not.toContain('backfill');
    expect(workflow).not.toContain('CATCH_UP');
  });

  it('uses only bounded GET retries to tolerate a Render cold start before discovery', () => {
    const start = workflow.indexOf('- name: Verify HML readiness');
    const end = workflow.indexOf('- name: Verify loaded Daily-6 runtime contract');
    const readiness = workflow.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(readiness).toContain('for readiness_attempt in 1 2 3; do');
    expect(readiness).toContain('"$HML_API_URL/health/live"');
    expect(readiness).toContain('--max-time 10 -X GET');
    expect(readiness).toContain('--fail --silent --show-error --max-time 15 -X GET');
    expect(readiness).toContain('sleep 5');
    expect(readiness).toContain('test "${readiness_ok:-false}" = true');
    expect(readiness).not.toContain('POST');
  });

  it('revalidates operational authorization immediately before each mutating Daily-6 POST', () => {
    const collectStepStart = workflow.indexOf('- name: Enqueue one bounded Daily-6 discovery job');
    const workerStepStart = workflow.indexOf(
      '- name: Run one bounded discovery and enrichment worker',
    );
    const collectStep = workflow.slice(collectStepStart, workerStepStart);
    expect(collectStep).toContain(
      'OPERATIONAL_AUTHORIZATION: ${{ vars.DAILY6_OPERATIONAL_AUTHORIZATION }}',
    );
    expect(collectStep).toContain(
      'OPERATIONAL_AUTH_EXPIRES_AT: ${{ vars.DAILY6_OPERATIONAL_AUTH_EXPIRES_AT }}',
    );
    expect(collectStep).toContain(
      'test "$OPERATIONAL_AUTHORIZATION" = \'DAILY6_NATIVE_SEND_AUTHORIZED_V1\'',
    );
    expect(collectStep).toContain('test "$expires_epoch" -gt "$(date -u +%s)"');
    expect(collectStep).toContain('SLOT_DEADLINE_EPOCH: ${{ steps.slot.outputs.deadline_epoch }}');
    expect(collectStep).toContain('test "$(date -u +%s)" -le "$SLOT_DEADLINE_EPOCH"');
    expect(collectStep.indexOf('test "$expires_epoch" -gt "$(date -u +%s)"')).toBeLessThan(
      collectStep.indexOf('-X POST "$HML_API_URL/collect"'),
    );
    expect(collectStep.indexOf('test "$(date -u +%s)" -le "$SLOT_DEADLINE_EPOCH"')).toBeLessThan(
      collectStep.indexOf('-X POST "$HML_API_URL/collect"'),
    );

    const runSlotStepStart = workflow.indexOf('- name: Run one authenticated native Daily-6 slot');
    const runSlotStep = workflow.slice(runSlotStepStart);
    expect(runSlotStep).toContain(
      'OPERATIONAL_AUTHORIZATION: ${{ vars.DAILY6_OPERATIONAL_AUTHORIZATION }}',
    );
    expect(runSlotStep).toContain(
      'OPERATIONAL_AUTH_EXPIRES_AT: ${{ vars.DAILY6_OPERATIONAL_AUTH_EXPIRES_AT }}',
    );
    expect(runSlotStep).toContain(
      'test "$OPERATIONAL_AUTHORIZATION" = \'DAILY6_NATIVE_SEND_AUTHORIZED_V1\'',
    );
    expect(runSlotStep).toContain('test "$expires_epoch" -gt "$(date -u +%s)"');
    expect(runSlotStep).toContain('SLOT_DEADLINE_EPOCH: ${{ steps.slot.outputs.deadline_epoch }}');
    expect(runSlotStep).toContain('test "$(date -u +%s)" -le "$SLOT_DEADLINE_EPOCH"');
    expect(runSlotStep.indexOf('test "$expires_epoch" -gt "$(date -u +%s)"')).toBeLessThan(
      runSlotStep.indexOf('-X POST "$HML_API_URL/internal/daily6/run-slot"'),
    );
    expect(runSlotStep.indexOf('test "$(date -u +%s)" -le "$SLOT_DEADLINE_EPOCH"')).toBeLessThan(
      runSlotStep.indexOf('-X POST "$HML_API_URL/internal/daily6/run-slot"'),
    );
  });

  it('reports aggregate rejection reasons without exposing candidate data', () => {
    const runSlotStart = workflow.indexOf('- name: Run one authenticated native Daily-6 slot');
    expect(runSlotStart).toBeGreaterThanOrEqual(0);
    const runSlot = workflow.slice(runSlotStart);
    expect(runSlot).toContain('rejectionReasons');
    expect(runSlot).not.toContain('businessName');
    expect(runSlot).not.toContain('email');
    expect(runSlot).not.toContain('phone');
  });
});
