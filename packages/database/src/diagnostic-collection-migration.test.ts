import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = (await readFile(new URL('../../../database/migrations/0074_diagnostic_collection_mode.sql', import.meta.url), 'utf8')).replace(/\r\n/gu, '\n');

describe('diagnostic collection persistence boundary', () => {
  it('separates diagnostic identities from Daily-6 and makes the mode immutable', () => {
    expect(migration).toContain("request_mode = 'DIAGNOSTIC'");
    expect(migration).toContain('enqueue_diagnostic_collection_job');
    expect(migration).toContain('COLLECTION_EXECUTION_IDENTITY_IMMUTABLE');
    expect(migration).toContain('DIAGNOSTIC_COLLECTION_IDEMPOTENCY_CONFLICT');
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS collection_jobs_request_identity_check[\s\S]*?ADD CONSTRAINT collection_jobs_request_identity_check/u);
    expect(migration).not.toMatch(/enqueue_diagnostic_collection_job[\s\S]*?INSERT INTO public\.daily6_batches/u);
  });

  it('rejects commercial side effects for the diagnostic namespace', () => {
    expect(migration).toContain('DIAGNOSTIC_COMMERCIAL_SIDE_EFFECT_FORBIDDEN');
    expect(migration).toContain('diagnostic_daily6_batch_guard');
    expect(migration).toContain('diagnostic_daily6_ledger_guard');
    expect(migration).toContain('diagnostic_campaign_outbox_guard');
    expect(migration).toContain('diagnostic_pilot_run_guard');
  });
});
