import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(
  new URL('../../../database/migrations/0067_daily6_terminalization_status_qualification.sql', import.meta.url),
  'utf8',
);

describe('Daily-6 terminalization status qualification migration', () => {
  it('qualifies the table status and preserves the immutable terminal contract', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION lead_finder_internal.finalize_daily6_batch');
    expect(migration).toContain('RETURNS TABLE(status text, terminal_reason text)');
    expect(migration).toContain("AND public.daily6_batches.status IN ('PENDING', 'RUNNING')");
    expect(migration).not.toContain("AND status IN ('PENDING', 'RUNNING')");
    expect(migration).toContain('RETURNING public.daily6_batches.status, public.daily6_batches.terminal_reason');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.finalize_daily6_batch');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION lead_finder_internal.finalize_daily6_batch');
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE\s+public\.daily6_batches/i);
  });

  it('keeps the input and terminal-state guards fail-closed', () => {
    expect(migration).toContain("RAISE EXCEPTION 'DAILY6_TERMINAL_METRICS_INVALID'");
    expect(migration).toContain("IF current_row.status IN ('COMPLETED', 'FAILED', 'BLOCKED')");
    expect(migration).toContain("final_status := 'BLOCKED'");
    expect(migration).toContain("final_reason := 'AMBIGUOUS_SEND'");
    expect(migration).toContain("final_status := 'COMPLETED'");
  });
});
