import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrichmentError, type BusinessContactEnrichmentProvider } from '@lead-finder/enrichment';

const database = vi.hoisted(() => ({
  claimCollection: vi.fn(),
  claimLegacyWebsiteRecheck: vi.fn(),
  finishCollection: vi.fn(),
  fillMissingLeadCollectionLocation: vi.fn(),
  getLeadByOsmIdentity: vi.fn(),
  listLeadEnrichmentStates: vi.fn(),
  recordLeadEnrichment: vi.fn(),
  insertLeads: vi.fn(),
  renewCollectionLease: vi.fn(),
}));

vi.mock('@lead-finder/database', () => database);

import { processNextJob } from './process-job.js';

const lead = {
  osmType: 'node' as const,
  osmId: '123',
  name: 'Empresa Teste',
  category: 'clinicas',
  phone: null,
  whatsapp: null,
  email: null,
  website: null,
  websiteStatus: 'UNKNOWN' as const,
  instagram: null,
  facebook: null,
  address: null,
  city: 'Campinas',
  state: 'SP',
  latitude: null,
  longitude: null,
  isClosed: false,
};

describe('collection source failure propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.claimCollection.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      leaseToken: '00000000-0000-4000-8000-000000000002',
      payload: { city: 'Campinas', state: 'SP', country: 'Brasil', category: 'clinicas', limit: 40 },
    });
    database.listLeadEnrichmentStates.mockResolvedValue([{
      osmType: 'node',
      osmId: '123',
      websiteStatus: 'UNKNOWN',
      isBlocked: false,
      doNotContact: false,
      isClosed: false,
      crmStage: 'NOVO',
      lastEnrichedAt: null,
      latestWebsiteEvidenceSource: null,
    }]);
    database.getLeadByOsmIdentity.mockResolvedValue({ id: '00000000-0000-4000-8000-000000000003' });
    database.renewCollectionLease.mockResolvedValue(true);
  });

  it('persists the terminal failure and reports the underlying provider without PII', async () => {
    const overpass = { collect: vi.fn().mockResolvedValue([lead]) };
    const enrichmentProvider: BusinessContactEnrichmentProvider = {
      name: 'composite-public-enrichment',
      enrich: vi.fn().mockRejectedValue(new EnrichmentError(
        'provider response included private details',
        'INVALID_SOURCE_RESPONSE',
        undefined,
        'TAVILY',
      )),
    };
    const onFailure = vi.fn();

    await expect(processNextJob(
      {} as never,
      overpass as never,
      enrichmentProvider,
      10,
      50,
      onFailure,
      '2026-09-22|09|campinas-sp|daily6-v1',
    )).resolves.toBe(true);

    expect(database.finishCollection).toHaveBeenCalledWith(
      {},
      '00000000-0000-4000-8000-000000000001',
      'INVALID_SOURCE_RESPONSE',
      '00000000-0000-4000-8000-000000000002',
    );
    expect(onFailure).toHaveBeenCalledWith({
      code: 'INVALID_SOURCE_RESPONSE',
      provider: 'TAVILY',
    });
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain('private details');
  });
});
