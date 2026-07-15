import { describe, expect, it, vi } from 'vitest';
import type { Database } from './index.js';
import { QualificationError, updateQualification } from './qualification.js';

describe('qualification non-contact persistence policy', () => {
  it.each([
    [{ isBlocked: true, doNotContact: false }, { isBlocked: false }],
    [{ isBlocked: false, doNotContact: true }, { doNotContact: false }],
  ] as const)('rejects clearing persisted flags before issuing an update', async (currentFlags, requestedFlags) => {
    const update = vi.fn();
    const current = { qualificationStatus: 'SEM_SITE_CONFIRMADO', ...currentFlags };
    const tx = {
      select: vi.fn(() => ({
        from: () => ({ where: () => ({ for: () => ({ limit: () => Promise.resolve([current]) }) }) }),
      })),
      update,
    };
    const db = { transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as Database;
    await expect(updateQualification(db, '00000000-0000-4000-8000-000000000001', {
      status: 'SEM_SITE_CONFIRMADO', actor: 'security-test', source: 'unit-test', ...requestedFlags,
    })).rejects.toEqual(expect.objectContaining<Partial<QualificationError>>({ code: 'INVALID_TRANSITION' }));
    expect(update).not.toHaveBeenCalled();
  });
});
