import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowPath = new URL(
  '../../../.github/workflows/daily6-render-wake-smoke.yml',
  import.meta.url,
);

describe('Daily-6 Render wake smoke workflow', () => {
  it('is manual-only and performs exactly one read-only liveness request', async () => {
    const workflow = (await readFile(workflowPath, 'utf8')).replace(/\r\n/g, '\n');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('schedule:');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('https://lead-finder-api-hml.onrender.com/health/live');
    expect(workflow).toContain('--max-time 15');
    expect(workflow).toContain('-X GET');
    expect(workflow).not.toContain('Authorization');
    expect(workflow).not.toContain('HML_DAILY6_TOKEN');
    expect(workflow).not.toContain('HML_DATABASE_URL');
    expect(workflow).not.toContain('/run-slot');
    expect(workflow).not.toContain('/collect');
    expect(workflow).not.toContain('-X POST');
    expect(workflow).not.toMatch(/\bPOST\b/);
  });
});
