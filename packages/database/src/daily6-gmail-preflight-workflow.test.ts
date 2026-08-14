import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  new URL('../../../.github/workflows/daily6-gmail-preflight.yml', import.meta.url),
  'utf8',
);

describe('Daily-6 Gmail read-only preflight workflow', () => {
  it('is manual-only and scoped to the HML environment', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+(schedule|push|pull_request|repository_dispatch):/m);
    expect(workflow).toContain('permissions:');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('environment: hml-discovery');
    expect(workflow).toContain('HML_DAILY6_TOKEN: ${{ secrets.HML_DAILY6_TOKEN }}');
  });

  it('performs one sanitized read-only request without retry or artifact output', () => {
    expect(workflow).toContain('https://lead-finder-api-hml.onrender.com/internal/daily6/gmail-preflight');
    expect(workflow).toContain('--max-time 30');
    expect(workflow).toContain('--write-out');
    expect(workflow).not.toContain('--retry');
    expect(workflow).not.toContain('set -x');
    expect(workflow).not.toContain('upload-artifact');
    expect(workflow).toContain('HTTP_STATUS=');
    expect(workflow).toContain('GMAIL_RUNTIME_AUTH=');
    expect(workflow).toContain('GMAIL_SENT_SEARCH=');
    expect(workflow).toContain('STATUS=GMAIL_PREFLIGHT_FAIL');
    expect(workflow).toContain('STATUS=GMAIL_PREFLIGHT_PASS');
    expect(workflow).not.toContain('cat "$response_file"');
    expect(workflow).not.toContain('echo "$response"');
  });
});
