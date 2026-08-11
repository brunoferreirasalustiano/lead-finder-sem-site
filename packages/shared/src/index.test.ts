import { describe, expect, it } from 'vitest';
import { collectSchema, collectionCityId, collectionRequestIdentitySchema, parseCollectionRequestIdentity } from './index.js';

describe('collectSchema', () => {
  it('accepts allowed category and defaults', () =>
    expect(collectSchema.parse({ category: 'oficinas' }).city).toBe('Campinas'));
  it('rejects arbitrary category and excessive limit', () => {
    expect(() => collectSchema.parse({ category: 'banks' })).toThrow();
    expect(() => collectSchema.parse({ category: 'oficinas', limit: 51 })).toThrow();
  });
  it('rejects arbitrary fields such as raw queries', () =>
    expect(() => collectSchema.parse({ category: 'oficinas', query: '[out:json]' })).toThrow());
});

describe('collection request identity', () => {
  it('distinguishes the supported daily slots and binds the city slug', () => {
    expect(collectionCityId('Campinas', 'SP')).toBe('campinas-sp');
    expect(parseCollectionRequestIdentity('2026-08-12|09|campinas-sp|daily6-v1')).toEqual({ date: '2026-08-12', slot: '09', cityId: 'campinas-sp', policyVersion: 'daily6-v1' });
    expect(collectionRequestIdentitySchema.safeParse('2026-08-12|13|campinas-sp|daily6-v1').success).toBe(true);
    expect(collectionRequestIdentitySchema.safeParse('2026-08-12|10|campinas-sp|daily6-v1').success).toBe(false);
  });
});
