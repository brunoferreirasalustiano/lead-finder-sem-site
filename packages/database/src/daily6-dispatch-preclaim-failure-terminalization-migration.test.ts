import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(
  new URL(
    '../../../database/migrations/0073_daily6_dispatch_preclaim_failure_terminalization.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('migration 0073 Daily-6 pre-claim failure terminalization', () => {
  it('allows an accepted dispatch to fail terminally without permitting pre-claim success', () => {
    expect(migration).toContain(
      "OLD.status = 'DISPATCH_ACCEPTED' AND NEW.status IN ('WORKFLOW_CLAIMED', 'WORKFLOW_FAILED')",
    );
    expect(migration).toContain(
      "status IN ('CLAIMED', 'DISPATCH_ACCEPTED') AND p_terminal_status = 'WORKFLOW_FAILED'",
    );
    expect(migration).not.toContain(
      "status IN ('CLAIMED', 'DISPATCH_ACCEPTED') AND p_terminal_status = 'WORKFLOW_SUCCEEDED'",
    );
  });

  it('preserves immutable identity, restrictive search path, and opaque runtime access', () => {
    expect(migration).toContain('DAILY6_SCHEDULER_IDENTITY_IMMUTABLE');
    expect(migration).toContain(
      'SET search_path = pg_catalog, public, lead_finder_internal',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION lead_finder_internal.finalize_daily6_scheduler_dispatch(uuid, text) FROM PUBLIC',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION lead_finder_internal.finalize_daily6_scheduler_dispatch(uuid, text)',
    );
    expect(migration).not.toContain(
      'GRANT SELECT ON TABLE public.daily6_scheduler_dispatches TO lead_finder_discovery_runtime',
    );
  });

  it('reconciles only the audited incident identities without a broad backfill', () => {
    expect(migration).toContain("request_identity = '2026-09-19|13|campinas-sp|daily6-v1'");
    expect(migration).toContain("request_identity = '2026-09-19|16|campinas-sp|daily6-v1'");
    expect(migration).toContain(
      "dispatch_nonce = '4359c702-0cc4-43ce-8e2d-6b5fdb609de7'::uuid",
    );
    expect(migration).toContain(
      "dispatch_nonce = '0615c18f-cf49-4196-89b8-3acff42680d1'::uuid",
    );
    expect(migration).toContain("status = 'DISPATCH_ACCEPTED'");
    expect(migration).not.toContain("WHERE status = 'DISPATCH_ACCEPTED'");
  });
});
