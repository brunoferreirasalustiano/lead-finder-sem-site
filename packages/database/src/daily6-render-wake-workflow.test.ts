import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = (await readFile(new URL('../../../.github/workflows/daily6-render-wake.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

describe('Daily-6 Render wake workflow', () => {
  it('uses the requested 14-minute pre-warm windows in Sao Paulo time', () => {
    for (const cron of [
      '0 12', '14 12', '28 12', '42 12', '56 12', '10 13',
      '0 16', '14 16', '28 16', '42 16', '56 16', '10 17',
      '0 19', '14 19', '28 19', '42 19', '56 19', '10 20',
    ]) expect(workflow).toContain(`cron: '${cron} * * *'`);
  });

  it('performs only a public GET liveness check without Daily-6 side effects', () => {
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('/health/live');
    expect(workflow).toContain('for wake_attempt in 1 2 3; do');
    expect(workflow).toContain('--max-time 15');
    expect(workflow).toContain('sleep 5');
    expect(workflow).not.toContain('/health/ready');
    expect(workflow).not.toContain('/collect');
    expect(workflow).not.toContain('run-slot');
    expect(workflow).not.toContain('HML_DAILY6_TOKEN');
    expect(workflow).not.toContain('workflow_dispatch');
    expect(workflow).not.toContain('POST');
  });
});
