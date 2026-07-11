import { describe, expect, it } from 'vitest';
import { collectSchema } from './index.js';

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
