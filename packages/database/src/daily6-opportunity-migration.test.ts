import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = (await readFile(
  new URL('../../../database/migrations/0065_daily6_opportunity_shadow.sql', import.meta.url),
  'utf8',
)).replace(/\r\n/gu, '\n');

describe('Daily-6 opportunity shadow migration', () => {
  it('exposes a broader read-only resolver without changing send eligibility', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION lead_finder_internal.list_daily6_opportunities');
    expect(migration).toContain('LANGUAGE sql');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('LEFT JOIN LATERAL');
    expect(migration).toContain("e.result='NO_OFFICIAL_SITE_CONFIRMED'");
    expect(migration).toContain('ORDER BY e.version DESC,e.id DESC');
    expect(migration).toContain('LIMIT greatest(0,least(coalesce(p_limit,0),100))');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_opportunities(text,text,integer) FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION lead_finder_internal.list_daily6_opportunities(text,text,integer)');
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(migration).not.toContain('gmail');
    expect(migration).not.toContain('run-slot');
  });
});
