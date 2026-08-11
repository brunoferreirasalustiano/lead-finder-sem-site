import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(new URL('../../../.github/workflows/discovery-pilot.yml', import.meta.url), 'utf8');

describe('discovery one-shot workflow contract', () => {
  it('is dispatch-only, exact-SHA pinned, and cannot access Gmail credentials', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('schedule:');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('ref: ${{ inputs.expected_sha }}');
    expect(workflow).toContain('WORKER_MODE: oneshot');
    expect(workflow).toContain('DEPLOYMENT_PROFILE: supabase-render');
    expect(workflow).not.toContain('DEPLOYMENT_PROFILE: oracle-vps');
    expect(workflow).toContain('ENRICHMENT_PROVIDER: composite');
    expect(workflow).toContain('TZ=America/Sao_Paulo date +%F');
    expect(workflow).not.toMatch(/GMAIL_(ACCESS|REFRESH|CLIENT)|EMAIL_PROVIDER_SECRET/u);
  });
});
