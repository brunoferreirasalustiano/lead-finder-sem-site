import { describe, expect, it, vi } from 'vitest';
import {
  CnpjWsBusinessRegistryProvider,
  CompositeBusinessEnrichmentProvider,
  EnrichmentError,
  matchRegistryToLead,
  TavilyBusinessSearchProvider,
  type BusinessEnrichmentRequest,
  type BusinessRegistryRecord,
  type SearchEvidence,
} from './index.js';

const lead: BusinessEnrichmentRequest['lead'] = {
  osmType: 'node', osmId: '1', name: 'All Beauty', category: 'saloes-de-beleza',
  phone: '+55 19 3333-4444', whatsapp: null, email: null, website: null,
  instagram: null, facebook: null, address: 'Rua das Flores, 10', city: 'Campinas', state: 'SP',
  latitude: null, longitude: null, isClosed: false,
};

const record: BusinessRegistryRecord = {
  cnpj: '12345678000190', businessName: 'ALL BEAUTY LTDA', tradeName: 'All Beauty', registrationStatus: 'ACTIVE',
  registrationStatusDate: new Date('2024-01-01T00:00:00Z'), address: 'Rua das Flores, 10', city: 'Campinas', state: 'SP',
  postalCode: '13000000', phone: '+55 19 3333-4444', email: 'contato@allbeauty.example', website: null,
  activity: 'Cabeleireiros', sourceLocator: 'https://publica.cnpj.ws/cnpj/12345678000190', observedAt: new Date('2026-08-01T00:00:00Z'),
};

const searchEvidence: SearchEvidence = {
  queryCount: 6, resultCount: 6, sourceLocator: 'https://instagram.com/allbeauty',
  publicResultLocators: ['https://instagram.com/allbeauty'], officialSiteFound: false, officialSiteLocators: [],
  ambiguousDomainMatches: 0, cnpjCandidates: ['12345678000190'], emailCandidates: [],
  recentActivitySources: [{ sourceLocator: 'https://instagram.com/allbeauty', observedAt: new Date('2026-08-01T00:00:00Z'), confidence: 0.9 }],
};

describe('registry matching', () => {
  it('rejects same name in a different city', () => {
    expect(matchRegistryToLead(lead, { ...record, city: 'Santos' }).decision).toBe('REJECTED');
  });

  it('strengthens a match with phone and address', () => {
    const result = matchRegistryToLead(lead, record);
    expect(result.decision).toBe('CONFIRMED');
    expect(result.reasons).toEqual(expect.arrayContaining(['NAME_MATCH', 'CITY_MATCH', 'PHONE_MATCH', 'ADDRESS_MATCH']));
  });

  it('rejects an incompatible company identifier and treats a weak match as ambiguous', () => {
    expect(matchRegistryToLead(lead, { ...record, businessName: 'Different Company', tradeName: 'Different Company' }).decision).toBe('REJECTED');
    expect(matchRegistryToLead(lead, { ...record, phone: null, address: null, tradeName: 'All Beauty Campinas' }).decision).toBe('AMBIGUOUS');
  });
});

describe('Tavily adapter', () => {
  it('fails closed when the credential is missing', async () => {
    const provider = new TavilyBusinessSearchProvider({ timeoutMs: 50, fetchFn: vi.fn() });
    await expect(provider.search({ lead })).rejects.toMatchObject({ code: 'ENRICHMENT_PROVIDER_DISABLED' } satisfies Partial<EnrichmentError>);
  });

  it('bounds queries and classifies third-party-only results without an owned website', async () => {
    const fetchFn = vi.fn().mockImplementation(() => new Response(JSON.stringify({ results: [{ url: 'https://instagram.com/allbeauty', title: 'All Beauty Campinas', content: 'CNPJ 12.345.678/0001-90', published_date: '2026-08-01T00:00:00Z' }] }), { status: 200 }));
    const provider = new TavilyBusinessSearchProvider({ apiKey: 'test', timeoutMs: 50, maxQueries: 99, maxResultsPerQuery: 99, fetchFn, sleepFn: () => Promise.resolve(), now: () => new Date('2026-08-10T00:00:00Z') });
    const result = await provider.search({ lead });
    expect(fetchFn).toHaveBeenCalledTimes(6);
    expect(result.queryCount).toBe(6);
    expect(result.officialSiteFound).toBe(false);
    expect(result.cnpjCandidates).toEqual(['12345678000190']);
  });

  it('maps rate limiting to a source state, never to no data', async () => {
    const provider = new TavilyBusinessSearchProvider({ apiKey: 'test', timeoutMs: 50, fetchFn: vi.fn().mockResolvedValue(new Response('', { status: 429 })), sleepFn: () => Promise.resolve() });
    await expect(provider.search({ lead })).rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED' });
  });
});

describe('CNPJ.ws adapter and composite', () => {
  it('extracts only the required public registry fields', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ razao_social: 'ALL BEAUTY LTDA', estabelecimento: { cnpj: '12345678000190', nome_fantasia: 'All Beauty', situacao_cadastral: 'ATIVA', cidade: { nome: 'Campinas' }, estado: { sigla: 'SP' }, logradouro: 'Rua das Flores', numero: '10', cep: '13000000', telefone1: '+55 19 3333-4444', email: 'contato@allbeauty.example', atividade_principal: { descricao: 'Cabeleireiros' } } }), { status: 200 }));
    const provider = new CnpjWsBusinessRegistryProvider({ timeoutMs: 50, maxRpm: 60, fetchFn, sleepFn: () => Promise.resolve(), now: () => new Date('2026-08-10T00:00:00Z') });
    await expect(provider.lookup('12.345.678/0001-90')).resolves.toMatchObject({ cnpj: '12345678000190', city: 'Campinas', state: 'SP', registrationStatus: 'ACTIVE', email: 'contato@allbeauty.example' });
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://publica.cnpj.ws/cnpj/12345678000190');
  });

  it('keeps registry rate limits and missing records explicit', async () => {
    const rateLimited = new CnpjWsBusinessRegistryProvider({ timeoutMs: 50, maxRpm: 60, fetchFn: vi.fn().mockResolvedValue(new Response('', { status: 429 })), sleepFn: () => Promise.resolve() });
    await expect(rateLimited.lookup('12345678000190')).rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED' });
    const missing = new CnpjWsBusinessRegistryProvider({ timeoutMs: 50, maxRpm: 60, fetchFn: vi.fn().mockResolvedValue(new Response('', { status: 404 })), sleepFn: () => Promise.resolve() });
    await expect(missing.lookup('12345678000190')).rejects.toMatchObject({ code: 'REGISTRY_NOT_FOUND' });
  });

  it('composes confirmed registry, recent activity and no-site evidence', async () => {
    const searchProvider = { name: 'search', search: vi.fn().mockResolvedValue(searchEvidence) };
    const registryProvider = { name: 'registry', lookup: vi.fn().mockResolvedValue(record) };
    const provider = new CompositeBusinessEnrichmentProvider({ searchProvider, registryProvider });
    const result = await provider.enrich({ lead });
    expect(result.identity.confirmed).toBe(true);
    expect(result.activity.status).toBe('ACTIVE');
    expect(result.website.officialSiteFound).toBe(false);
    expect(result.website.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.emails[0]).toMatchObject({ businessAssociation: 'PASS', inferred: false });
  });

  it('does not qualify ambiguous multiple registry matches', async () => {
    const searchProvider = { name: 'search', search: vi.fn().mockResolvedValue({ ...searchEvidence, cnpjCandidates: ['12345678000190', '12345678000191'] }) };
    const registryProvider = { name: 'registry', lookup: vi.fn().mockResolvedValue(record) };
    const result = await new CompositeBusinessEnrichmentProvider({ searchProvider, registryProvider }).enrich({ lead });
    expect(result.identity.confirmed).toBe(false);
    expect(result.website.confidence).toBeLessThan(0.85);
  });
});
