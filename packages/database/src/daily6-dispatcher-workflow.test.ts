import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(new URL('../../../.github/workflows/daily6-dispatcher.yml', import.meta.url), 'utf8');

describe('native Daily-6 scheduler control plane', () => {
  it('runs from the default-branch schedule with an immutable HML pin', () => {
    expect(workflow).toContain("cron: '7 12 * * *'");
    expect(workflow).toContain("cron: '7 16 * * *'");
    expect(workflow).toContain("cron: '7 19 * * *'");
    expect(workflow).toContain('HML_BRANCH: hml/render-supabase-plan-b');
    expect(workflow).toContain('EXPECTED_OPERATIONAL_SHA: 1f9a40e715cbf5bd791627e25879b5f356224726');
    expect(workflow).toContain('test "$remote_sha" = "$EXPECTED_SHA"');
  });

  it('pins the native scope and hard slot quota without slot replay', () => {
    expect(workflow).toContain('test "$date" = "$today"');
    expect(workflow).toContain('[[ "$slot" =~ ^(09|13|16)$ ]]');
    expect(workflow).toContain("test \"${GITHUB_RUN_ATTEMPT:-1}\" = '1'");
    expect(workflow).toContain("MAX_SCHEDULE_LATENESS_SECONDS: '1800'");
    expect(workflow).toContain('test "$lateness_seconds" -le "$MAX_SCHEDULE_LATENESS_SECONDS"');
    expect(workflow).toContain("format('{0}|{1}', inputs.date, inputs.slot)");
    expect(workflow).toContain('Campinas');
    expect(workflow).toContain('.sent <= 2');
    expect(workflow).toContain('HML_COLLECTION_TOKEN');
    expect(workflow).toContain('HML_DATABASE_URL');
    expect(workflow).toContain('DISCOVERY_EXECUTED=true');
    expect(workflow).toContain('DISCOVERY_TERMINAL_STATUS=COMPLETED');
    expect(workflow).toContain('collection_jobs');
    expect(workflow).not.toContain('backfill');
    expect(workflow).not.toContain('CATCH_UP');
  });
});
