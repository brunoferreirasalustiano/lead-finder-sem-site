import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = (await readFile(new URL('../../../.github/workflows/discovery-diagnostic.yml', import.meta.url), 'utf8')).replace(/\r\n/gu, '\n');

describe('discovery diagnostic workflow contract', () => {
  it('is manual, exact-SHA bound, non-commercial, and bounded', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('schedule:');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('group: daily6-dispatcher');
    expect(workflow).toContain('ref: ${{ inputs.expected_sha }}');
    expect(workflow).toContain('REQUEST_MODE=DIAGNOSTIC');
    expect(workflow).toContain('COMMERCIAL_SLOT=NONE');
    expect(workflow).toContain('WORKER_MODE: oneshot');
    expect(workflow).toContain('MAX_JOBS_PER_RUN: \'1\'');
    expect(workflow).toContain('REAL_SEND_ENABLED: \'false\'');
    expect(workflow).toContain('REAL_PROVIDERS_ENABLED: \'false\'');
    expect(workflow).toContain('DAILY6_QUOTA_CONSUMED=0');
    expect(workflow).toContain('REAL_EMAIL_PROVIDER_CALLS=0');
    expect(workflow).toContain('WHATSAPP_SENT=0');
    expect(workflow).toContain("test \"$row\" = 'DIAGNOSTIC|COMPLETED|NONE'");
    expect(workflow).toContain('.hostedCommitSha == $expected_sha');
    expect(workflow).toContain("parseWorkerConfig(process.env)");
    expect(workflow).toContain("database_user\" != 'lead_finder_discovery_runtime'");
    expect(workflow).toContain('database/security/check_discovery_worker_capabilities.sql');
    expect(workflow).toContain('DISCOVERY_DATABASE_CAPABILITIES=PASS');
    expect(workflow).toContain('Generate isolated diagnostic identity');
    expect(workflow).toContain('REQUEST_IDENTITY=$request_identity');
    expect(workflow).toContain('for readiness_attempt in 1 2 3; do');
    expect(workflow).toContain('node apps/worker/dist/index.js >"$worker_log" 2>&1');
    expect(workflow).not.toContain('tee worker.log');
    expect(workflow).not.toContain('cat "$worker_log"');
    expect(workflow.match(/get_diagnostic_commercial_snapshot\(\)/gu)).toHaveLength(2);
    expect(workflow).not.toMatch(/select count\(\*\) from public\.(daily6_batches|daily6_send_ledger|campaign_outbox|pilot_manual_email_send_attempts)/u);
    expect(workflow).not.toContain('PII_SAFE_TELEMETRY=PASS');
    expect(workflow).not.toMatch(/secrets\.GMAIL|secrets\.WHATSAPP/u);
    expect(workflow).not.toContain('daily6-v1');

    const identityGeneration = workflow.indexOf('Generate isolated diagnostic identity');
    const configValidation = workflow.indexOf('Validate bounded worker configuration before enqueue');
    const databaseValidation = workflow.indexOf('Validate bounded worker database identity before enqueue');
    const baseline = workflow.indexOf('Capture commercial side-effect baseline');
    const enqueue = workflow.indexOf('Enqueue isolated diagnostic collection');
    expect(identityGeneration).toBeGreaterThan(-1);
    expect(configValidation).toBeGreaterThan(identityGeneration);
    expect(databaseValidation).toBeGreaterThan(configValidation);
    expect(baseline).toBeGreaterThan(databaseValidation);
    expect(enqueue).toBeGreaterThan(baseline);
  });
});
