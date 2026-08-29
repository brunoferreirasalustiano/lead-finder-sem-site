import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(
  new URL('../../../database/migrations/0070_daily6_supabase_scheduler.sql', import.meta.url),
  'utf8',
);
const runtimeAcl = await readFile(
  new URL(
    '../../../database/security/create_lead_finder_discovery_runtime_hml.sql',
    import.meta.url,
  ),
  'utf8',
);
const supabaseAdapter = await readFile(
  new URL('../../../deploy/supabase/cron/daily6-github-scheduler.sql', import.meta.url),
  'utf8',
);

describe('migration 0070 Daily-6 Supabase scheduler', () => {
  it('creates an inactive natural-slot cron without embedding secrets', () => {
    expect(supabaseAdapter).toContain("'7 12,16,19 * * *'");
    expect(supabaseAdapter).toContain('active := false');
    expect(supabaseAdapter).toContain('enabled boolean NOT NULL DEFAULT false');
    expect(supabaseAdapter).toContain('daily6_scheduler_invoke_secret');
    expect(supabaseAdapter).toContain('vault.decrypted_secrets');
    expect(supabaseAdapter).toContain('ON CONFLICT (singleton) DO NOTHING');
    expect(supabaseAdapter).toContain('IF existing_job_id IS NULL THEN');
    expect(supabaseAdapter).not.toContain('cron.unschedule');
    expect(supabaseAdapter).not.toContain('ON CONFLICT (singleton) DO UPDATE');
    expect(supabaseAdapter).not.toMatch(/gh[pousr]_[A-Za-z0-9_]+/u);
    expect(supabaseAdapter).not.toContain('PRIVATE KEY');
    expect(migration).not.toContain('pg_cron');
    expect(migration).not.toContain('pg_net');
  });

  it('provides an immutable at-most-once dispatch ledger with terminal ambiguity', () => {
    expect(migration).toContain('request_identity text NOT NULL UNIQUE');
    expect(migration).toContain('dispatch_nonce uuid NOT NULL UNIQUE');
    expect(migration).toContain("'DISPATCH_AMBIGUOUS'");
    expect(migration).toContain("'HML_CONFIGURATION_REJECTED'");
    expect(migration).toContain('DAILY6_SCHEDULER_IDENTITY_IMMUTABLE');
    expect(migration).toContain('DAILY6_SCHEDULER_DISPATCH_DELETE_FORBIDDEN');
    expect(migration).toContain("AND status IN ('CLAIMED', 'DISPATCH_ACCEPTED')");
    expect(migration).toContain(
      "OLD.status = 'CLAIMED' AND NEW.status IN ('DISPATCH_ACCEPTED', 'DISPATCH_REJECTED', 'DISPATCH_AMBIGUOUS', 'WORKFLOW_CLAIMED', 'WORKFLOW_FAILED')",
    );
    expect(migration).toContain("status = 'CLAIMED' AND p_terminal_status = 'WORKFLOW_FAILED'");
  });

  it('keeps public roles out and grants only opaque functions to discovery runtime', () => {
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.daily6_scheduler_dispatches FROM PUBLIC',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION lead_finder_internal.claim_daily6_scheduler_dispatch(text, uuid) FROM PUBLIC',
    );
    expect(migration).not.toContain(
      'GRANT SELECT ON TABLE public.daily6_scheduler_dispatches TO lead_finder_discovery_runtime',
    );
    expect(runtimeAcl).toContain('claim_daily6_scheduler_dispatch(text, uuid)');
    expect(runtimeAcl).toContain('finalize_daily6_scheduler_dispatch(uuid, text)');
  });
});
