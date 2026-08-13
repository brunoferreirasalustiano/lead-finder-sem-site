import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = (await readFile(
  new URL('../../../database/migrations/0056_daily6_automated_compliance.sql', import.meta.url),
  'utf8',
)).replace(/\r\n/gu, '\n');
const workflow = (await readFile(
  new URL('../../../.github/workflows/discovery-pilot.yml', import.meta.url),
  'utf8',
)).replace(/\r\n/gu, '\n');
const daily6Workflow = (await readFile(
  new URL('../../../.github/workflows/daily6-slot.yml', import.meta.url),
  'utf8',
)).replace(/\r\n/gu, '\n');

describe('Daily-6 automated compliance contract', () => {
  it('keeps machine decisions distinct from human decisions', () => {
    expect(migration).toContain("'AUTOMATED_COMPLIANCE'");
    expect(migration).toContain('human_decision IN (\'APPROVED\',\'REJECTED\',\'AUTOMATED_COMPLIANCE\')');
    expect(migration).toContain("approval_source='AUTOMATED_COMPLIANCE'");
    expect(migration).toContain("source,added_by)\n  VALUES(run_row.id,p_lead_id,'AUTOMATED_DISCOVERY'");
    expect(migration).toContain('false,\n    c.evidence_ids');
  });

  it('uses current verified evidence and never status alone', () => {
    expect(migration).toContain("e.verification_status='VERIFIED'");
    expect(migration).toContain("e.result='EMAIL_BUSINESS_ASSOCIATION_PASS'");
    expect(migration).toContain("e.confidence::numeric >= 0.800");
    expect(migration).toContain("e.result='NO_OFFICIAL_SITE_CONFIRMED'");
    expect(migration).toContain("e.confidence >= 0.900");
  });

  it('makes empty-slot runs durable and replay-safe', () => {
    expect(migration).toContain('ensure_daily6_batch');
    expect(migration).toContain('greatest(discovered,p_discovered)');
    expect(migration).toContain('greatest(ready,p_ready)');
  });

  it('does not place Gmail credentials in the discovery workflow', () => {
    expect(workflow).toContain('permissions:');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('vars.HML_API_URL');
    expect(workflow).not.toMatch(/GMAIL_(?:ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET)/);
    expect(workflow).not.toContain('gmail.googleapis.com');
  });

  it('keeps the Daily-6 trigger manual, exact-SHA, and Gmail-isolated', () => {
    expect(daily6Workflow).toContain('workflow_dispatch:');
    expect(daily6Workflow).not.toContain('schedule:');
    expect(daily6Workflow).toContain('contents: read');
    expect(daily6Workflow).toContain('ref: ' + '${{ inputs.expected_sha }}');
    expect(daily6Workflow).toContain('/internal/daily6/run-slot');
    expect(daily6Workflow).not.toMatch(/GMAIL_(?:ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET)/);
  });
});
