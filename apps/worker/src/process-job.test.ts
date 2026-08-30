import { describe, expect, it } from 'vitest';
import type { NormalizedLead } from '@lead-finder/shared';
import { applyCollectionAreaDefaults, selectEnrichmentCandidates } from './process-job.js';
import type { LeadEnrichmentState } from '@lead-finder/database';

const lead = (osmId: string, overrides: Partial<NormalizedLead> = {}): NormalizedLead => ({
  osmType: 'node',
  osmId,
  name: `Empresa ${osmId}`,
  category: 'saloes-de-beleza',
  phone: null,
  whatsapp: null,
  email: null,
  website: null,
  websiteStatus: 'UNKNOWN',
  instagram: null,
  facebook: null,
  address: null,
  city: null,
  state: null,
  latitude: null,
  longitude: null,
  isClosed: false,
  ...overrides,
});

const state = (
  osmId: string,
  overrides: Partial<LeadEnrichmentState> = {},
): LeadEnrichmentState => ({
  osmType: 'node',
  osmId,
  websiteStatus: 'UNKNOWN',
  isBlocked: false,
  doNotContact: false,
  isClosed: false,
  crmStage: 'NOVO',
  lastEnrichedAt: null,
  ...overrides,
});

describe('Daily-6 collection opportunity funnel', () => {
  it('preserves the requested collection area when OSM omits city and state', () => {
    const [normalized] = applyCollectionAreaDefaults({ city: 'Campinas', state: 'SP' }, [
      lead('1'),
    ]);

    expect(normalized).toMatchObject({ city: 'Campinas', state: 'SP' });
  });

  it('does not overwrite explicit OSM location fields', () => {
    const [normalized] = applyCollectionAreaDefaults({ city: 'Campinas', state: 'SP' }, [
      lead('1', { city: 'Valinhos', state: 'SP' }),
    ]);

    expect(normalized).toMatchObject({ city: 'Valinhos', state: 'SP' });
  });

  it('prioritizes never-enriched candidates and then the oldest evidence', () => {
    const candidates = [lead('recent'), lead('never'), lead('old')];
    const states = [
      state('recent', { lastEnrichedAt: new Date('2026-08-29T00:00:00Z') }),
      state('never'),
      state('old', { lastEnrichedAt: new Date('2026-08-01T00:00:00Z') }),
    ];

    expect(selectEnrichmentCandidates(candidates, states, 3).map((item) => item.osmId)).toEqual([
      'never',
      'old',
      'recent',
    ]);
  });

  it('deduplicates OSM identities before spending the enrichment budget', () => {
    const candidates = [lead('duplicate'), lead('duplicate'), lead('other')];
    const states = [state('duplicate'), state('other')];

    expect(selectEnrichmentCandidates(candidates, states, 10).map((item) => item.osmId)).toEqual([
      'duplicate',
      'other',
    ]);
  });

  it('keeps safety and known-official-site exclusions fail-closed', () => {
    const candidates = [
      lead('valid'),
      lead('blocked'),
      lead('dnc'),
      lead('closed'),
      lead('nao'),
      lead('site'),
      lead('fresh-closed', { isClosed: true }),
      lead('fresh-site', { websiteStatus: 'OFFICIAL_SITE_FOUND' }),
    ];
    const states = [
      state('valid'),
      state('blocked', { isBlocked: true }),
      state('dnc', { doNotContact: true }),
      state('closed', { isClosed: true }),
      state('nao', { crmStage: 'NAO_CONTATAR' }),
      state('site', { websiteStatus: 'OFFICIAL_SITE_FOUND' }),
      state('fresh-closed'),
      state('fresh-site'),
    ];

    expect(selectEnrichmentCandidates(candidates, states, 10).map((item) => item.osmId)).toEqual([
      'valid',
    ]);
  });
});
