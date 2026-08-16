import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  new URL('../../../.github/workflows/schedule-heartbeat.yml', import.meta.url),
  'utf8',
);

describe('Daily-6 schedule heartbeat contract', () => {
  it('has only independent scheduled observation and no commercial access', () => {
    expect(workflow).toContain("cron: '17,47 * * * *'");
    expect(workflow).toContain('github.event.schedule');
    expect(workflow).toContain('GITHUB_RUN_ID');
    expect(workflow).toContain('GITHUB_SHA');
    expect(workflow).toContain('GITHUB_REF');
    expect(workflow).not.toContain('workflow_dispatch');
    expect(workflow).not.toContain('hml-discovery');
    expect(workflow).not.toContain('HML_DAILY6_TOKEN');
    expect(workflow).not.toContain('HML_COLLECTION_TOKEN');
    expect(workflow).not.toContain('HML_DATABASE_URL');
    expect(workflow).not.toContain('DATABASE_URL');
    expect(workflow).not.toContain('TAVILY');
    expect(workflow).not.toContain('secrets.');
    expect(workflow).not.toContain('vars.');
    expect(workflow).not.toContain('environment:');
    expect(workflow).not.toContain('Gmail');
    expect(workflow).not.toContain('/internal/daily6');
    expect(workflow).not.toContain('/collect');
  });
});
