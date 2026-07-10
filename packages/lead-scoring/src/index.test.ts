import { describe, expect, it } from 'vitest';
import type { NormalizedLead } from '@lead-finder/shared';
import { calculateLeadScore } from './index.js';

const base: NormalizedLead = {
  osmType: 'node',
  osmId: '1',
  name: 'X',
  category: 'oficinas',
  phone: null,
  whatsapp: null,
  email: null,
  website: null,
  instagram: null,
  facebook: null,
  address: null,
  city: null,
  state: null,
  latitude: null,
  longitude: null,
  isClosed: false,
};
describe('calculateLeadScore', () => {
  it('adds signals and caps at 100', () =>
    expect(
      calculateLeadScore({
        ...base,
        phone: '1',
        whatsapp: '1',
        email: 'a@b.c',
        instagram: 'x',
        address: 'a',
      }),
    ).toBe(100));
  it('penalizes sparse and inactive records without going negative', () =>
    expect(calculateLeadScore({ ...base, isClosed: true })).toBe(0));
});
