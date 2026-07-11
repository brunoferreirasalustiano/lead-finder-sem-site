import { describe, expect, it, vi } from 'vitest';
import {
  buildOverpassQuery,
  hasRegisteredWebsite,
  normalizeElement,
  OverpassClient,
} from './index.js';
describe('website detection', () =>
  it('checks all supported keys', () => {
    expect(hasRegisteredWebsite({ 'contact:website': 'https://x.test' })).toBe(true);
    expect(hasRegisteredWebsite({ name: 'X' })).toBe(false);
  }));
describe('normalization', () =>
  it('maps contact, address and center', () =>
    expect(
      normalizeElement(
        {
          type: 'way',
          id: 42,
          center: { lat: -22.9, lon: -47.1 },
          tags: {
            name: 'Oficina X',
            'contact:phone': '123',
            'addr:street': 'Rua A',
            'addr:housenumber': '10',
          },
        },
        'oficinas',
      ),
    ).toMatchObject({
      osmType: 'way',
      osmId: '42',
      name: 'Oficina X',
      phone: '123',
      address: 'Rua A, 10',
      latitude: -22.9,
    })));
describe('query', () =>
  it('uses allowlisted category and no client query', () =>
    expect(
      buildOverpassQuery({
        city: 'Campinas',
        state: 'SP',
        country: 'Brasil',
        category: 'restaurantes',
        limit: 50,
      }),
    ).toContain('amenity')));
describe('retry', () =>
  it('retries 429 then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    const client = new OverpassClient({
      endpoint: 'https://x.test',
      timeoutMs: 100,
      maxRetries: 1,
      fetchFn,
    });
    await expect(
      client.collect({
        city: 'Campinas',
        state: 'SP',
        country: 'Brasil',
        category: 'oficinas',
        limit: 1,
      }),
    ).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  }, 2000));
