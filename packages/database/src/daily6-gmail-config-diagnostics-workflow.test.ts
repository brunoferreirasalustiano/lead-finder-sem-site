import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  new URL('../../../.github/workflows/daily6-gmail-config-diagnostics.yml', import.meta.url),
  'utf8',
);

describe('Daily-6 Gmail config diagnostics workflow', () => {
  it('is manual-only and scoped to the HML environment', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+(schedule|push|pull_request|repository_dispatch):/m);
    expect(workflow).toContain('permissions:');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('environment: hml-discovery');
    expect(workflow).toContain('HML_DAILY6_TOKEN: ${{ secrets.HML_DAILY6_TOKEN }}');
  });

  it('performs one sanitized read-only request without retry or artifact output', () => {
    expect(workflow).toContain('https://lead-finder-api-hml.onrender.com/internal/daily6/gmail-config-diagnostics');
    expect(workflow).toContain('--max-time 30');
    expect(workflow).toContain('--write-out');
    expect(workflow).not.toContain('--retry');
    expect(workflow).not.toContain('set -x');
    expect(workflow).not.toContain('upload-artifact');
    expect(workflow).toContain('MANUAL_EMAIL_SEND_ENABLED=');
    expect(workflow).toContain('MANUAL_EMAIL_SENDER_MATCH=');
    expect(workflow).toContain('GOOGLE_CLIENT_ID_CONFIGURED=');
    expect(workflow).toContain('GOOGLE_CLIENT_SECRET_CONFIGURED=');
    expect(workflow).toContain('GOOGLE_REFRESH_TOKEN_CONFIGURED=');
    expect(workflow).toContain('FINGERPRINT_KEY_CONFIGURED=');
    expect(workflow).toContain('OPERATOR_EMAIL_TEST_ENABLED=');
    expect(workflow).toContain('OPERATOR_EMAIL_TEST_SENDER_MATCH=');
    expect(workflow).toContain('OPERATOR_EMAIL_TEST_GOOGLE_REFRESH_TOKEN_CONFIGURED=');
    expect(workflow).toContain('DAILY6_PILOT_ENABLED=');
    expect(workflow).toContain('REAL_SEND_ENABLED=');
    expect(workflow).toContain('MANUAL_EMAIL_KILL_SWITCH_ENABLED=');
    expect(workflow).toContain('REAL_PROVIDER_CONFIGURED=');
    expect(workflow).toContain('REAL_PROVIDERS_ENABLED=');
    expect(workflow).toContain('COLLECTION_EGRESS_ENABLED=');
    expect(workflow).toContain('ENRICHMENT_EGRESS_ENABLED=');
    expect(workflow).toContain('HML_DAILY6_AUTH_ENABLED=');
    expect(workflow).toContain('EXPECTED_OPERATIONAL_SHA_CONFIGURED=');
    expect(workflow).toContain('STATUS=GMAIL_CONFIG_DIAGNOSTICS_FAIL');
    expect(workflow).toContain('STATUS=GMAIL_CONFIG_DIAGNOSTICS_PASS');
    expect(workflow).not.toContain('cat "$response_file"');
    expect(workflow).not.toContain('echo "$response"');
  });
});
