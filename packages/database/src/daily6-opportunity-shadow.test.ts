import { describe, expect, it, vi } from 'vitest';
import type { Database } from './index.js';
import { listDaily6OpportunityShadow } from './daily6-opportunity-shadow.js';

const row = {
  lead_id: '00000000-0000-4000-8000-000000000001',
  city: 'Campinas',
  category: 'servicos',
  identity_state: 'UNKNOWN',
  activity_state: 'INACTIVE',
  email_state: 'UNSUITABLE',
  website_state: 'NO_OFFICIAL_SITE_CONFIRMED',
  lead_blocked: false,
  business_closed: false,
  prior_contact: false,
  duplicate: false,
  pending_or_ambiguous_send: false,
  suppressed: false,
  hard_bounce: false,
  opt_out: false,
  do_not_contact: false,
  nao_contatar: false,
  email_channel_allowed: false,
  current_evidence_present: false,
  legacy_status_only: true,
};

describe('listDaily6OpportunityShadow', () => {
  it('preserves UNKNOWN and explicit negative states without granting send authority', async () => {
    const execute = vi.fn().mockResolvedValue([row]);
    const result = await listDaily6OpportunityShadow({ execute } as unknown as Database, {
      city: 'Campinas',
      limit: 30,
    });
    expect(result).toEqual([row]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed on an unexpected state value', async () => {
    const execute = vi.fn().mockResolvedValue([{ ...row, identity_state: 'FALSE' }]);
    await expect(listDaily6OpportunityShadow({ execute } as unknown as Database, {
      city: 'Campinas',
      limit: 30,
    })).rejects.toThrow('IDENTITY_STATE_NOT_PROVEN');
  });

  it.each([
    ['lead_id', { lead_id: 'not-a-uuid' }, 'LEAD_ID_NOT_PROVEN'],
    ['city', { city: '   ' }, 'CITY_NOT_PROVEN'],
    ['category', { category: 'x'.repeat(101) }, 'CATEGORY_NOT_PROVEN'],
  ])('fails closed on invalid %s', async (_field, override, error) => {
    const execute = vi.fn().mockResolvedValue([{ ...row, ...override }]);
    await expect(listDaily6OpportunityShadow({ execute } as unknown as Database, {
      city: 'Campinas',
      limit: 30,
    })).rejects.toThrow(error);
  });
});
