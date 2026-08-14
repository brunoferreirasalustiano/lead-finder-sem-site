import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(new URL('../../../.github/workflows/daily6-dispatcher.yml', import.meta.url), 'utf8');

describe('native Daily-6 scheduler control plane', () => {
  it('runs from the default-branch schedule with an immutable HML pin', () => {
    expect(workflow).toContain("cron: '0 12 * * *'");
    expect(workflow).toContain("cron: '0 16 * * *'");
    expect(workflow).toContain("cron: '0 19 * * *'");
    expect(workflow).toContain('HML_BRANCH: hml/render-supabase-plan-b');
    expect(workflow).toContain('EXPECTED_OPERATIONAL_SHA: 835e2aaaf2d165164ec7c5c98c80255dd503c88c');
    expect(workflow).toContain('test "$remote_sha" = "$EXPECTED_SHA"');
  });

  it('pins the native scope and hard slot quota without slot replay', () => {
    expect(workflow).toContain('test "$date" = "$today"');
    expect(workflow).toContain('[[ "$slot" =~ ^(09|13|16)$ ]]');
    expect(workflow).toContain('Campinas');
    expect(workflow).toContain('.sent <= 2');
    expect(workflow).not.toContain('backfill');
    expect(workflow).not.toContain('CATCH_UP');
  });
});
