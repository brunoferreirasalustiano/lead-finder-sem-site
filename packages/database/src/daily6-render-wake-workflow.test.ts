import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = (await readFile(new URL('../../../.github/workflows/daily6-render-wake.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

describe('Daily-6 Render wake workflow', () => {
  it('pings only the three one-hour windows at 13-minute intervals', () => {
    expect(workflow).toContain("cron: '7,20,33,46,59 12 * * *'");
    expect(workflow).toContain("cron: '7 13 * * *'");
    expect(workflow).toContain("cron: '7,20,33,46,59 16 * * *'");
    expect(workflow).toContain("cron: '7 17 * * *'");
    expect(workflow).toContain("cron: '7,20,33,46,59 19 * * *'");
    expect(workflow).toContain("cron: '7 20 * * *'");
    expect(workflow).toContain('09:07-10:07 America/Sao_Paulo');
    expect(workflow).toContain('13:07-14:07 America/Sao_Paulo');
    expect(workflow).toContain('16:07-17:07 America/Sao_Paulo');
  });

  it('uses a read-only liveness GET without secrets or commercial actions', () => {
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('/health/live');
    expect(workflow).toContain('curl --fail --silent --show-error --max-time 15 -X GET');
    expect(workflow).not.toContain('Authorization:');
    expect(workflow).not.toContain('/health/ready');
    expect(workflow).not.toContain('/collect');
    expect(workflow).not.toContain('run-slot');
    expect(workflow).not.toContain('-X POST');
    expect(workflow).not.toContain('workflow_dispatch');
    expect(workflow).not.toContain('POST');
    expect(workflow).not.toContain('HML_DAILY6_TOKEN');
    expect(workflow).not.toContain('HML_DATABASE_URL');
  });
});
