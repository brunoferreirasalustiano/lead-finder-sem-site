import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const edge = await readFile(
  new URL('../../../deploy/supabase/functions/daily6-github-scheduler/index.ts', import.meta.url),
  'utf8',
);

describe('Daily-6 Supabase Edge Function contract', () => {
  it('uses fixed HML and GitHub destinations with a dedicated secret', () => {
    expect(edge).toContain("GITHUB_OWNER = 'brunoferreirasalustiano'");
    expect(edge).toContain("GITHUB_REPOSITORY = 'lead-finder-sem-site'");
    expect(edge).toContain("GITHUB_WORKFLOW = 'daily6-dispatcher.yml'");
    expect(edge).toContain("GITHUB_REF = 'main'");
    expect(edge).toContain("hostname !== 'lead-finder-api-hml.onrender.com'");
    expect(edge).toContain("hmlApiUrl.pathname !== '/'");
    expect(edge).toContain("hmlApiUrl.username !== ''");
    expect(edge).toContain("hmlApiUrl.password !== ''");
    expect(edge).toContain("hmlApiUrl.port !== ''");
    expect(edge).toContain("hmlApiUrl.search !== ''");
    expect(edge).toContain("hmlApiUrl.hash !== ''");
    expect(edge).toContain('DAILY6_SCHEDULER_INVOKE_SECRET');
  });

  it('wakes Render only with one bounded GET and never invokes commercial endpoints', () => {
    expect(edge).toContain("new URL('/health/live', hmlApiUrl)");
    expect(edge).toContain("method: 'GET'");
    expect(edge).not.toContain('/collect');
    expect(edge).not.toContain('/run-slot');
    expect(edge).not.toContain('gmail');
    expect(edge).not.toContain('provider');
    expect(edge).not.toContain('retry');
  });

  it('provides a read-only preflight and never logs secrets or response bodies', () => {
    expect(edge).toContain("if (request.method === 'GET') return await preflight");
    expect(edge).toContain('sideEffects: 0');
    expect(edge).not.toContain('console.');
    expect(edge).not.toContain('Authorization header');
  });
});
