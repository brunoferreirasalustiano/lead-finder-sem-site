import { describe, expect, it, vi } from 'vitest';
import type { Database } from './index.js';
import {
  getProspectingCityMetricsSnapshot,
  getProspectingCityState,
  getRecentProspectingRunsByCity,
} from './prospecting-metrics.js';

const emptyDb = () => ({ execute: vi.fn().mockResolvedValue([]) } as unknown as Database);

describe('prospecting persistence contracts', () => {
  it('returns a deterministic empty snapshot without PII', async () => {
    const snapshot = await getProspectingCityMetricsSnapshot(emptyDb());
    expect(snapshot.currentCity).toBe('Campinas');
    expect(snapshot.nextCity).toBe('Valinhos');
    expect(snapshot.cities).toHaveLength(6);
    expect(JSON.stringify(snapshot)).not.toMatch(/phone|email|message|lead|token|whatsapp/i);
  });

  it('keeps the configured city order for an empty state', async () => {
    const state = await getProspectingCityState(emptyDb());
    expect(state).toBeNull();
    const db = emptyDb();
    await expect(getRecentProspectingRunsByCity(db, 'Campinas', 'bad key with spaces')).rejects.toThrow('campaignKey');
  });
});
