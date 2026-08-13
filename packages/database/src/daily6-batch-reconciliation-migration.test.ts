import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(
  new URL('../../../database/migrations/0060_daily6_collection_terminal_reconciliation.sql', import.meta.url),
  'utf8',
);
const hmlSupplement = await readFile(
  new URL('../../../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
);

describe('Daily-6 collection terminal reconciliation migration', () => {
  it('converges a failed collection to a failed batch without reopening the identity', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS terminal_reason text');
    expect(migration).toContain("CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED'))");
    expect(migration).toContain('sync_daily6_batch_from_collection(text)');
    expect(migration).toContain("SET status = 'FAILED'");
    expect(migration).toContain("terminal_reason = 'COLLECTION_FAILED:' || collection_error_code");
    expect(migration).toContain('job_row.error');
    expect(migration).toContain("job_row.error ~ '^[A-Z0-9_]{1,80}$'");
    expect(migration).toContain('DAILY6_BATCH_TERMINAL');
    expect(migration).toContain('daily6_batch_terminal_guard');
    expect(migration).toContain('daily6_collection_job_terminal_guard');
    expect(migration).toContain('prevent_terminal_daily6_collection_job');
    expect(migration).toContain('daily6_send_ledger_terminal_guard');
    expect(migration).toContain('prevent_terminal_daily6_send_ledger');
  });

  it('is fail-closed for leases, attempts, ambiguity, and every send ledger', () => {
    expect(migration).toContain("RETURN QUERY SELECT false, 'ACTIVE_IN_PROGRESS'");
    expect(migration).toContain("RETURN QUERY SELECT false, 'AMBIGUOUS_DO_NOT_TOUCH'");
    expect(migration).toContain("RETURN QUERY SELECT false, 'SEND_SIDE_EFFECT_PRESENT'");
    expect(migration).toContain("e.event_type = 'AMBIGUOUS'");
    expect(migration).toContain('daily6_send_ledger');
    expect(migration).toContain('pilot_manual_email_send_attempts');
    expect(migration).toContain('pilot_manual_email_send_events');
    expect(migration).toContain('campaign_outbox');
    expect(migration).toContain('crm_idempotency_keys');
    expect(migration).toContain('pilot_idempotency_keys');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  it('keeps terminal recovery operator-only and the worker boundary narrow', () => {
    expect(migration).toContain('reconcile_orphaned_daily6_batch(text)');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.reconcile_orphaned_daily6_batch(text) FROM PUBLIC');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.sync_daily6_batch_from_collection(text) FROM PUBLIC');
    expect(migration).not.toContain('GRANT SELECT ON TABLE public.daily6_batches');
    expect(hmlSupplement).toContain('lead_finder_internal.sync_daily6_batch_from_collection(text)');
    expect(hmlSupplement).not.toContain('reconcile_orphaned_daily6_batch(text)');
  });

  it('preserves idempotent replay and blocks terminal send reuse', () => {
    expect(migration).toContain("IF batch_row.status = 'FAILED' THEN");
    expect(migration).toContain("RETURN QUERY SELECT false, 'ALREADY_TERMINAL'");
    expect(migration).toContain("IF batch_status IN ('FAILED', 'BLOCKED', 'COMPLETED') THEN");
    expect(migration).toContain("RAISE EXCEPTION 'DAILY6_BATCH_TERMINAL'");
    expect(migration).toContain('collection_jobs');
    expect(migration).toContain('request_identity');
    expect(migration).toContain('The durable request identity is consumed');
  });
});
