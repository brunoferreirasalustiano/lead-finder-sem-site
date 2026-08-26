import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(process.cwd(), 'database/migrations/0069_daily6_pre_send_failure_terminalization.sql'), 'utf8');

describe('daily6 pre-send failure terminalization migration', () => {
  it('is fail-closed, bounded, and runtime-granted only for the guarded function', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION lead_finder_internal.terminalize_daily6_without_send');
    expect(migration).toContain("p_reason NOT IN ('RUN_SLOT_FAILURE', 'STALE_PENDING_BATCH')");
    expect(migration).toContain("p_reason = 'STALE_PENDING_BATCH' AND p_min_age_seconds < 3600");
    expect(migration).toContain("p_reason = 'RUN_SLOT_FAILURE' AND p_min_age_seconds <> 0");
    expect(migration).toContain("collection_status IN ('PENDING', 'PROCESSING')");
    expect(migration).toContain("COLLECTION_FAILED_USE_RECONCILER");
    expect(migration).toContain("SEND_SIDE_EFFECT_PRESENT");
    expect(migration).toContain('pilot_manual_message_preparations');
    expect(migration).toContain('pilot_manual_email_send_attempts');
    expect(migration).toContain('daily6_send_ledger');
    expect(migration).toContain('campaign_outbox');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.terminalize_daily6_without_send');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION lead_finder_internal.terminalize_daily6_without_send');
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE\s+public\./i);
  });
});
