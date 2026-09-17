import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(
  new URL('../../../database/migrations/0072_daily6_latest_business_evidence.sql', import.meta.url),
  'utf8',
);

describe('Daily-6 latest business evidence migration', () => {
  it('uses the newest append-only decision for every commercial evidence gate', () => {
    expect(migration).toContain('lead_evidence_daily6_latest_idx');
    for (const evidenceType of ['BUSINESS_IDENTITY', 'BUSINESS_ACTIVITY', 'WEBSITE', 'BUSINESS_EMAIL']) {
      expect(migration).toContain(`e.evidence_type='${evidenceType}'`);
    }
    expect(migration.match(/ORDER BY e\.observed_at DESC,e\.created_at DESC,e\.id DESC/g)).toHaveLength(4);
    expect(migration).not.toMatch(/EXISTS\s*\([\s\S]*evidence_type='BUSINESS_ACTIVITY'[\s\S]*result='ACTIVE'/u);
    expect(migration).not.toMatch(/EXISTS\s*\([\s\S]*evidence_type='WEBSITE'[\s\S]*NO_OFFICIAL_SITE_CONFIRMED/u);
  });

  it('preserves least privilege and the bounded resolver contract', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path=pg_catalog,public');
    expect(migration).toContain('least(coalesce(p_limit,0),40)');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_candidates(text,text,integer) FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION lead_finder_internal.list_daily6_candidates(text,text,integer)');
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE/iu);
  });
});
