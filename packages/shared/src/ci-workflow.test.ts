import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);

describe('CI dependency audit contract', () => {
  it('runs the bounded audit in the supabase-render matrix profile', () => {
    expect(workflow).toContain('deployment-profile: [oracle-vps, supabase-render]');
    expect(workflow.match(/if: matrix\.deployment-profile == 'supabase-render'/g)).toHaveLength(2);
    expect(workflow).not.toContain('matrix.profile');
    expect(workflow).toContain('Run bounded high-severity dependency audit');
  });
});
