import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(
  new URL('../../../database/migrations/0055_daily6_atomic_reservations.sql', import.meta.url),
  'utf8',
);

describe('Daily-6 atomic reservation migration', () => {
  it('keeps the ledger opaque and quota state durable', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS reserved integer NOT NULL DEFAULT 0');
    expect(migration).toContain('daily6_batches_reserved_check');
    expect(migration).toContain('DAILY6_EXISTING_LEDGER_EXCEEDS_BATCH_QUOTA');
    expect(migration).toContain('SET reserved = l.reserved');
    expect(migration).toContain('daily6_recipient_fingerprint_uidx');
    expect(migration).toContain("'daily6-v1'");
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('DAILY6_BATCH_QUOTA_EXCEEDED');
    expect(migration).toContain('DAILY6_DAILY_QUOTA_EXCEEDED');
    expect(migration).not.toContain('recipient_email');
  });

  it('does not expose SECURITY DEFINER reservation functions publicly', () => {
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS lead_finder_internal');
    expect(migration).toContain('REVOKE ALL ON SCHEMA lead_finder_internal FROM PUBLIC');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.reserve_daily6_send');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.finalize_daily6_send');
    expect(migration).toContain('TO lead_finder_api_runtime');
  });

  it('consumes reservations on all terminal outcomes and never retries ambiguity', () => {
    expect(migration).toContain("p_status NOT IN ('SENT', 'FAILED', 'AMBIGUOUS')");
    expect(migration).toContain('SET status = p_status');
    expect(migration).toContain('ambiguous = ambiguous + CASE WHEN p_status = \'AMBIGUOUS\' THEN 1 ELSE 0 END');
    expect(migration).toContain('SET reserved = reserved + 1');
    expect(migration).not.toContain('reserved = reserved - 1');
  });
});
