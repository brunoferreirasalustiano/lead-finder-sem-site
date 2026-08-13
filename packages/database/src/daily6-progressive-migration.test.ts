import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(
  new URL('../../../database/migrations/0061_daily6_progressive_discovery_pool.sql', import.meta.url),
  'utf8',
);

describe('Daily-6 progressive discovery migration', () => {
  it('keeps the resolver bounded at forty and preserves the runtime boundary', () => {
    expect(migration).toContain('least(coalesce(p_limit,0),40)');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path=pg_catalog,public');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_candidates(text,text,integer) FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION lead_finder_internal.list_daily6_candidates(text,text,integer)');
  });
});
