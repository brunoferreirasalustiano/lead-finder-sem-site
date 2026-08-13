import { describe, expect, it, vi } from 'vitest';
import { renewCollectionLease, type Database } from './index.js';

const databaseWithReturning = (rows: Array<{ id: string }>): Database => {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update } as unknown as Database;
};

describe('collection lease renewal', () => {
  it('renews only when the owner-bound update returns the job', async () => {
    const db = databaseWithReturning([{ id: 'job-1' }]);
    await expect(renewCollectionLease(db, 'job-1', '00000000-0000-4000-8000-000000000001')).resolves.toBe(true);
  });

  it('reports a fenced or expired lease without reviving it', async () => {
    const db = databaseWithReturning([]);
    await expect(renewCollectionLease(db, 'job-1', '00000000-0000-4000-8000-000000000001')).resolves.toBe(false);
  });
});
