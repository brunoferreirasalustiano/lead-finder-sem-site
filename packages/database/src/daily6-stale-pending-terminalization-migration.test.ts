import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../../../database/migrations/0068_daily6_stale_pending_terminalization.sql', import.meta.url);

describe('Daily-6 stale pending terminalization migration', () => {
  it('is idempotent, fail-closed, owner-only and never requeues an identity', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION lead_finder_internal.terminalize_stale_daily6_pending');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('p_min_age_seconds < 3600');
    expect(migration).toContain('LEASE_PRESENT');
    expect(migration).toContain('TOO_FRESH');
    expect(migration).toContain('SIDE_EFFECT_PRESENT');
    expect(migration).toContain("SET status = 'FAILED'");
    expect(migration).not.toContain("SET status = 'PENDING'");
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.terminalize_stale_daily6_pending(text, integer) FROM PUBLIC');
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]+lead_finder_api_runtime/i);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]+lead_finder_discovery_runtime/i);
  });
});
