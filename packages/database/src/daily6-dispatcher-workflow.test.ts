import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(new URL('../../../.github/workflows/daily6-dispatcher.yml', import.meta.url), 'utf8');

describe('native Daily-6 scheduler control plane', () => {
  it('runs from the default-branch schedule with an immutable HML pin', () => {
    expect(workflow).toContain("cron: '7 12 * * *'");
    expect(workflow).toContain("cron: '7 16 * * *'");
    expect(workflow).toContain("cron: '7 19 * * *'");
    expect(workflow).toContain('HML_BRANCH: hml/render-supabase-plan-b');
    expect(workflow).toContain('EXPECTED_OPERATIONAL_SHA: f96ee8b10b7da55ec2e5bd5f69b5b44b6c063985');
    expect(workflow).toContain('test "$remote_sha" = "$EXPECTED_SHA"');
  });

  it('builds the discovery worker from the exact approved HML SHA', () => {
    const checkoutStart = workflow.indexOf('- name: Checkout exact approved HML worker source');
    const buildStart = workflow.indexOf('- name: Build the bounded discovery worker');
    const workerStart = workflow.indexOf('- name: Run one bounded discovery and enrichment worker');
    expect(checkoutStart).toBeGreaterThanOrEqual(0);
    expect(buildStart).toBeGreaterThan(checkoutStart);
    expect(workerStart).toBeGreaterThan(buildStart);
    const build = workflow.slice(checkoutStart, workerStart);
    expect(build).toContain('ref: ${{ env.EXPECTED_OPERATIONAL_SHA }}');
    expect(build).toContain('path: hml-worker');
    expect(build).toContain('working-directory: hml-worker');
    expect(workflow).toContain('node hml-worker/apps/worker/dist/index.js');
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
    expect(worker).not.toContain('cat "$worker_log"');
    expect(worker).not.toContain('printf \'%s\' "$worker_log"');
  });

  it('pins the native scope and hard slot quota without slot replay', () => {
    expect(workflow).toContain('test "$date" = "$today"');
    expect(workflow).toContain('[[ "$slot" =~ ^(09|13|16)$ ]]');
    expect(workflow).toContain("test \"${GITHUB_RUN_ATTEMPT:-1}\" = '1'");
    expect(workflow).toContain("MAX_SCHEDULE_LATENESS_SECONDS: '3600'");
    expect(workflow).toContain('test "$lateness_seconds" -le "$MAX_SCHEDULE_LATENESS_SECONDS"');
    expect(workflow).toContain("format('{0}|{1}', inputs.date, inputs.slot)");
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
    const start = workflow.indexOf('test -n "$TAVILY_API_KEY"');
    const end = workflow.indexOf('request_identity="${SLOT_DATE}|${SLOT}|campinas-sp|daily6-v1"');
    const readiness = workflow.slice(start, end);
    expect(readiness).toContain('for readiness_attempt in 1 2 3; do');
    expect(readiness).toContain('--fail --silent --show-error --max-time 15 -X GET');
    expect(readiness).toContain('sleep 5');
    expect(readiness).toContain('test "${readiness_ok:-false}" = true');
    expect(readiness).not.toContain('POST');
  });

  it('revalidates operational authorization immediately before each mutating Daily-6 POST', () => {
    const collectStepStart = workflow.indexOf('- name: Enqueue one bounded Daily-6 discovery job');
    const workerStepStart = workflow.indexOf('- name: Run one bounded discovery and enrichment worker');
    const collectStep = workflow.slice(collectStepStart, workerStepStart);
    expect(collectStep).toContain('OPERATIONAL_AUTHORIZATION: ${{ vars.DAILY6_OPERATIONAL_AUTHORIZATION }}');
    expect(collectStep).toContain('OPERATIONAL_AUTH_EXPIRES_AT: ${{ vars.DAILY6_OPERATIONAL_AUTH_EXPIRES_AT }}');
    expect(collectStep).toContain("test \"$OPERATIONAL_AUTHORIZATION\" = 'DAILY6_NATIVE_SEND_AUTHORIZED_V1'");
    expect(collectStep).toContain('test "$expires_epoch" -gt "$(date -u +%s)"');
    expect(collectStep.indexOf('test "$expires_epoch" -gt "$(date -u +%s)"')).toBeLessThan(collectStep.indexOf('-X POST "$HML_API_URL/collect"'));

    const runSlotStepStart = workflow.indexOf('- name: Run one authenticated native Daily-6 slot');
    const runSlotStep = workflow.slice(runSlotStepStart);
    expect(runSlotStep).toContain('OPERATIONAL_AUTHORIZATION: ${{ vars.DAILY6_OPERATIONAL_AUTHORIZATION }}');
    expect(runSlotStep).toContain('OPERATIONAL_AUTH_EXPIRES_AT: ${{ vars.DAILY6_OPERATIONAL_AUTH_EXPIRES_AT }}');
    expect(runSlotStep).toContain("test \"$OPERATIONAL_AUTHORIZATION\" = 'DAILY6_NATIVE_SEND_AUTHORIZED_V1'");
    expect(runSlotStep).toContain('test "$expires_epoch" -gt "$(date -u +%s)"');
    expect(runSlotStep.indexOf('test "$expires_epoch" -gt "$(date -u +%s)"')).toBeLessThan(runSlotStep.indexOf('-X POST "$HML_API_URL/internal/daily6/run-slot"'));
  });
});
