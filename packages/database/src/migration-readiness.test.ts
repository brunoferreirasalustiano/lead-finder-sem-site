import { describe, expect, it, vi } from 'vitest';
import type { Database } from './index.js';
import { checkExpectedMigration } from './index.js';

const version = '0024_crm_idempotency_safe_results';

describe('migration readiness', () => {
  it('accepts the latest required privacy migration from the local registry', async () => {
    const execute = vi.fn().mockResolvedValue([{ version }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('accepts the latest required privacy migration from the Supabase registry without writing local history', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ name: version }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('fails closed when neither registry contains the latest required privacy migration', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });

  it('fails closed when the Supabase registry exists without the latest required privacy migration', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });

  it('does not accept the preceding 0021 migration as application-ready', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
    const queries = execute.mock.calls.map(([query]) => String(query));
    expect(queries.join('\n')).not.toContain('0021_operator_channel_test');
  });
});
