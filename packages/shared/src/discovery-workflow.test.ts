import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = (await readFile(new URL('../../../.github/workflows/discovery-pilot.yml', import.meta.url), 'utf8')).replace(/\r\n/gu, '\n');

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
    expect(workflow).toContain('PROVIDER_HEALTH_OR_USAGE_EVIDENCE=PASS');
    expect(workflow).toContain('PROVIDER_CALL_ACCOUNTING=PASS');
    expect(workflow).toContain('COLLECTION_STATUS=COMPLETED');
    expect(workflow).toContain('COLLECTION_STATUS=FAILED');
    expect(workflow).toContain('PENDING|PROCESSING|\'\'');
    expect(workflow).toContain('CNPJ_PROVIDER_MAX_RPM: \'3\'');
    expect(workflow).toContain('[[ ! "$request_identity" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\\|(09|13|16)\\|[a-z0-9-]+\\|daily6-v1$ ]]');
    expect(workflow).toContain("where request_identity = '$request_identity'");
    expect(workflow).toContain("where request_identity = '$REQUEST_IDENTITY'");
    expect(workflow).not.toContain("where request_identity = :'request_identity'");
    expect(workflow).not.toMatch(/GMAIL_(ACCESS|REFRESH|CLIENT)|EMAIL_PROVIDER_SECRET/u);
  });
});
