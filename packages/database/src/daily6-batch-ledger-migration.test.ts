import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../../../database/migrations/0054_daily6_batch_ledger.sql', import.meta.url), 'utf8');

describe('daily-6 batch ledger migration', () => {
  it('pins the policy limits and stores only opaque recipient fingerprints', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.daily6_batches');
    expect(migration).toContain('max_sends_per_batch smallint NOT NULL DEFAULT 2 CHECK (max_sends_per_batch = 2)');
    expect(migration).toContain('max_sends_per_day smallint NOT NULL DEFAULT 6 CHECK (max_sends_per_day = 6)');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.daily6_send_ledger');
    expect(migration).toContain('recipient_fingerprint char(64)');
    expect(migration).not.toContain('recipient_email');
    expect(migration).toContain('ALTER TABLE public.daily6_batches ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.daily6_send_ledger ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.daily6_batches, public.daily6_send_ledger FROM PUBLIC');
  });
});
