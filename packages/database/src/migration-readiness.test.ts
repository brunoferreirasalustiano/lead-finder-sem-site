import { describe, expect, it, vi } from 'vitest';
import type { Database } from './index.js';
import { checkExpectedMigration } from './index.js';

const version = '0028_prospecting_runtime_deny_all_reconciliation';

describe('migration readiness', () => {
  it('accepts migration 0028 from the local registry', async () => {
    const execute = vi.fn().mockResolvedValue([{ version }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('accepts migration 0028 from the Supabase registry without writing local history', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ name: version }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('fails closed when neither registry contains migration 0028', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });

  it('fails closed when the Supabase registry exists without migration 0028', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });

  it('does not accept a database migrated only through 0027 prospecting metrics', async () => {
    // The local registry lookup for the deny-all reconciliation returns no row
    // when only 0027_prospecting_city_metrics exists.
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });
});
