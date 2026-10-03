import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = (await readFile(new URL('../../../.github/workflows/discovery-diagnostic.yml', import.meta.url), 'utf8')).replace(/\r\n/gu, '\n');

describe('discovery diagnostic workflow contract', () => {
  it('is manual, exact-SHA bound, non-commercial, and bounded', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('schedule:');
    expect(workflow).toContain('permissions:\n  contents: read');
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
    expect(workflow).not.toMatch(/secrets\.GMAIL|secrets\.WHATSAPP/u);
    expect(workflow).not.toContain('daily6-v1');
  });
});
