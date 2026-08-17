import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(
  new URL('../../../database/migrations/0064_daily6_control_plane_identity_guard.sql', import.meta.url),
  'utf8',
);

describe('Daily-6 control-plane identity guard migration', () => {
  it('uses a fail-closed SECURITY DEFINER read boundary for the discovery role', () => {
    expect(migration).toContain('lead_finder_internal.daily6_batch_identity_exists(text)');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain("TO lead_finder_discovery_runtime");
    expect(migration).toContain("WHEN p_batch_id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'");
  });

  it('does not widen direct table access or expose the function publicly', () => {
    expect(migration).toContain('REVOKE ALL ON SCHEMA lead_finder_internal FROM PUBLIC');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.daily6_batch_identity_exists(text) FROM PUBLIC');
    expect(migration).not.toMatch(/GRANT\s+(SELECT|ALL).*daily6_batches/i);
    expect(migration).not.toContain('recipient_email');
  });
});
