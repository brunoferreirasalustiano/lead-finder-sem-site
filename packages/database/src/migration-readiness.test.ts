import { describe, expect, it, vi } from 'vitest';
import type { Database } from './index.js';
import { checkExpectedMigration } from './index.js';

const version = '0027_prospecting_city_metrics';

describe('migration readiness', () => {
  it('accepts migration 0027 from the local registry', async () => {
    const execute = vi.fn().mockResolvedValue([{ version }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('accepts migration 0027 from the Supabase registry without writing local history', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ name: version }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('fails closed when neither registry contains migration 0027', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });

  it('fails closed when the Supabase registry exists without migration 0027', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });

  it('does not accept a database migrated only through 0026', async () => {
    // The local registry lookup for 0027 returns no row when only 0026 exists.
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });
});
