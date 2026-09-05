import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL(
  '../../../database/migrations/0071_daily6_discovery_runtime_acl_recovery.sql',
  import.meta.url,
);

describe('Daily-6 discovery runtime ACL recovery migration', () => {
  it('adds only the worker permissions that the repository actually uses', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    expect(migration).toContain('GRANT UPDATE (city,state)');
    expect(migration).toContain('ON TABLE public.leads');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION lead_finder_internal.sync_daily6_batch_from_collection(text)',
    );
    expect(migration).not.toMatch(/GRANT\s+UPDATE\s+ON\s+(TABLE\s+)?public\.leads/i);
    expect(migration).not.toMatch(/daily6_send_ledger[^;]+TO lead_finder_discovery_runtime/i);
  });

  it('provides an owner-only fail-closed terminalizer for expired processing jobs', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION lead_finder_internal.terminalize_expired_daily6_processing',
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain("job_row.status <> 'PROCESSING'");
    expect(migration).toContain('LEASE_NOT_EXPIRED');
    expect(migration).toContain('SEND_SIDE_EFFECT_PRESENT');
    expect(migration).toContain("SET status = 'FAILED'");
    expect(migration).not.toContain("SET status = 'PENDING'");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION lead_finder_internal.terminalize_expired_daily6_processing(text, integer) FROM PUBLIC',
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION[^;]+terminalize_expired_daily6_processing[^;]+lead_finder_(api|discovery)_runtime/i,
    );
  });
});
