import type { NormalizedLead } from '@lead-finder/shared';
import {
  EnrichmentError,
  isPublicSourceLocator,
  isBusinessEmailAddress,
  parseRetryAfterSeconds,
  type BusinessContactEnrichmentProvider,
  type BusinessEnrichmentRequest,
  type BusinessEnrichmentResult,
  type ProviderCallTelemetry,
} from './index.js';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const CNPJ_WS_ENDPOINT = 'https://publica.cnpj.ws/cnpj';
const MAX_CNPJ_CANDIDATES = 5;
const MAX_QUERY_LENGTH = 180;
const ACTIVITY_WINDOW_MS = 180 * 24 * 60 * 60 * 1_000;

export type RegistryMatchDecision = 'CONFIRMED' | 'AMBIGUOUS' | 'REJECTED';

export interface SearchEvidence {
  queryCount: number;
  resultCount: number;
  sourceLocator: string;
  publicResultLocators: string[];
  officialSiteFound: boolean;
  officialSiteLocators: string[];
  ambiguousDomainMatches: number;
  cnpjCandidates: string[];
  emailCandidates: Array<{ value: string; sourceLocator: string; confidence: number }>;
  recentActivitySources: Array<{ sourceLocator: string; observedAt: Date; confidence: number }>;
}

export interface WebSearchEvidenceProvider {
  readonly name: string;
  search(request: BusinessEnrichmentRequest): Promise<SearchEvidence>;
}

export interface BusinessRegistryRecord {
  cnpj: string;
  businessName: string;
  tradeName: string | null;
  registrationStatus: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  registrationStatusDate: Date | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  activity: string | null;
  sourceLocator: string;
  observedAt: Date;
}

export interface BusinessRegistryProvider {
  readonly name: string;
  lookup(cnpj: string): Promise<BusinessRegistryRecord>;
}

export interface TavilyBusinessSearchProviderOptions {
  apiKey?: string;
  timeoutMs: number;
  maxQueries?: number;
  maxResultsPerQuery?: number;
  maxRetries?: number;
  minIntervalMs?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => Date;
  onCall?: (event: ProviderCallTelemetry) => void;
  rateLimitRecoveryMaxWaitMs?: number;
}

export interface CnpjWsBusinessRegistryProviderOptions {
  timeoutMs: number;
  maxRetries?: number;
  maxRpm?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => Date;
  onCall?: (event: ProviderCallTelemetry) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const safeText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const normalizeText = (value: string | null | undefined): string => (value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
const normalizeDigits = (value: string | null | undefined): string => (value ?? '').replace(/\D/gu, '');
const CNPJ_BODY_LENGTH = 12;
const CNPJ_BODY_PATTERN = /^[A-Z0-9]{12}$/u;
const CNPJ_PATTERN = /^[A-Z0-9]{12}\d{2}$/u;
const CNPJ_SEPARATOR_PATTERN = /[.\s/-]/gu;
const CNPJ_DV_WEIGHTS = [
  [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
] as const;

export const normalizeCnpj = (value: string): string => value.trim().toUpperCase().replace(CNPJ_SEPARATOR_PATTERN, '');

const cnpjCharacterValue = (character: string): number => character.charCodeAt(0) - 48;
const calculateCnpjDigit = (value: string, weights: readonly number[]): number => {
  const sum = [...value].reduce((total, character, index) => total + cnpjCharacterValue(character) * weights[index]!, 0);
  const digit = 11 - (sum % 11);
  return digit >= 10 ? 0 : digit;
};

/** Validates legacy numeric and Receita Federal alphanumeric CNPJ identifiers. */
export const isValidCnpj = (value: string): boolean => {
  const cnpj = normalizeCnpj(value);
  if (!CNPJ_PATTERN.test(cnpj) || !CNPJ_BODY_PATTERN.test(cnpj.slice(0, CNPJ_BODY_LENGTH))) return false;
  if (/^([A-Z0-9])\1{13}$/u.test(cnpj)) return false;
  const firstDigit = calculateCnpjDigit(cnpj.slice(0, CNPJ_BODY_LENGTH), CNPJ_DV_WEIGHTS[0]);
  const secondDigit = calculateCnpjDigit(`${cnpj.slice(0, CNPJ_BODY_LENGTH)}${firstDigit}`, CNPJ_DV_WEIGHTS[1]);
  return cnpj.endsWith(`${firstDigit}${secondDigit}`);
};
const sourceFallback = 'https://tavily.com/';

const thirdPartyHosts = new Set([
  'instagram.com', 'facebook.com', 'linktr.ee', 'google.com', 'google.com.br', 'maps.google.com',
  'yelp.com', 'tripadvisor.com', 'ifood.com.br', 'fresha.com', 'booksy.com', 'cnpj.ws',
  'publica.cnpj.ws', 'cnpj.biz', 'casadosdados.com.br', 'empresasdobrasil.com', 'guiamais.com.br',
  'telelistas.net', 'apontador.com.br', 'tudogostoso.com.br', 'tiktok.com', 'youtube.com',
]);

const hostOf = (locator: string): string => {
  try { return new URL(locator).hostname.toLowerCase().replace(/^www\./u, '').replace(/\.$/u, ''); } catch { return ''; }
};
const isThirdPartyHost = (host: string): boolean => [...thirdPartyHosts].some((known) => host === known || host.endsWith(`.${known}`));
const isOfficialCandidate = (locator: string): boolean => {
  const host = hostOf(locator);
  return host !== '' && !isThirdPartyHost(host) && !host.includes('tavily.');
};

const buildQueries = (lead: NormalizedLead): string[] => {
  const name = safeText(lead.name) || 'empresa';
  const city = safeText(lead.city);
  const phone = safeText(lead.phone);
  const address = safeText(lead.address);
  return [
    `"${name}" "${city}"`,
    phone ? `"${name}" "${phone}"` : '',
    address ? `"${name}" "${address}"` : '',
    `"${name}" ${city} CNPJ`,
    `"${name}" ${city} site`,
    `"${name}" ${city} contato`,
  ].filter(Boolean).slice(0, 6).map((query) => query.slice(0, MAX_QUERY_LENGTH));
};

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const cnpjPattern = /(?<![A-Z0-9])(?:[A-Z0-9]{12}\d{2}|[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-\d{2})(?![A-Z0-9])/giu;

type TavilyResult = { url?: unknown; title?: unknown; content?: unknown; published_date?: unknown };

export class TavilyBusinessSearchProvider implements WebSearchEvidenceProvider {
  readonly name = 'tavily-business-search';
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private lastRequestAt = 0;

  constructor(private readonly options: TavilyBusinessSearchProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn = options.sleepFn ?? sleep;
    this.now = options.now ?? (() => new Date());
  }

  async search(request: BusinessEnrichmentRequest): Promise<SearchEvidence> {
    if (!this.options.apiKey?.trim()) throw new EnrichmentError('Tavily credential is unavailable', 'ENRICHMENT_PROVIDER_DISABLED');
    const queries = buildQueries(request.lead).slice(0, Math.min(this.options.maxQueries ?? 6, 6));
    const publicResultLocators: string[] = [];
    const officialSiteLocators: string[] = [];
    const cnpjCandidates = new Set<string>();
    const emailCandidates = new Map<string, { value: string; sourceLocator: string; confidence: number }>();
    const recentActivitySources: Array<{ sourceLocator: string; observedAt: Date; confidence: number }> = [];
    let resultCount = 0;
    let completedQueries = 0;
    let ambiguousDomainMatches = 0;
    for (const query of queries) {
      const payload = await this.request(query);
      completedQueries += 1;
      for (const result of payload) {
        const locator = safeText(result.url);
        if (!isPublicSourceLocator(locator)) continue;
        const title = safeText(result.title);
        const content = safeText(result.content).slice(0, 20_000);
        const combined = `${title}\n${content}`;
        resultCount += 1;
        publicResultLocators.push(locator);
        for (const cnpj of combined.match(cnpjPattern) ?? []) cnpjCandidates.add(normalizeCnpj(cnpj));
        for (const email of combined.match(emailPattern) ?? []) {
          const value = email.toLowerCase();
          emailCandidates.set(value, { value, sourceLocator: locator, confidence: 0.65 });
        }
        if (isOfficialCandidate(locator)) officialSiteLocators.push(locator);
        const published = safeText(result.published_date);
        const observedAt = published ? new Date(published) : null;
        if (observedAt && !Number.isNaN(observedAt.valueOf()) && this.now().valueOf() - observedAt.valueOf() <= ACTIVITY_WINDOW_MS && observedAt.valueOf() <= this.now().valueOf() + 86_400_000) {
          recentActivitySources.push({ sourceLocator: locator, observedAt, confidence: 0.8 });
        }
      }
    }
    if (officialSiteLocators.length > 1) {
      const domains = new Set(officialSiteLocators.map(hostOf));
      ambiguousDomainMatches = domains.size > 1 ? domains.size : 0;
    }
    return {
      queryCount: completedQueries,
      resultCount,
      sourceLocator: publicResultLocators[0] ?? sourceFallback,
      publicResultLocators: [...new Set(publicResultLocators)],
      officialSiteFound: officialSiteLocators.length > 0,
      officialSiteLocators: [...new Set(officialSiteLocators)],
      ambiguousDomainMatches,
      cnpjCandidates: [...cnpjCandidates].map(normalizeCnpj).filter(isValidCnpj).slice(0, MAX_CNPJ_CANDIDATES),
      emailCandidates: [...emailCandidates.values()].slice(0, 20),
      recentActivitySources: recentActivitySources.slice(0, 20),
    };
  }

  private async request(query: string): Promise<TavilyResult[]> {
    let lastError: unknown;
    const maxRetries = Math.min(this.options.maxRetries ?? 1, 2);
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const minIntervalMs = this.options.minIntervalMs ?? 0;
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < minIntervalMs) await this.sleepFn(minIntervalMs - elapsed);
      this.lastRequestAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      this.options.onCall?.({ provider: 'TAVILY', outcome: 'ATTEMPT' });
      let resultRecorded = false;
      const recordResult = (event: ProviderCallTelemetry): void => {
        resultRecorded = true;
        this.options.onCall?.(event);
      };
      try {
        const response = await this.fetchFn(TAVILY_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey!.trim()}` },
          body: JSON.stringify({ api_key: this.options.apiKey!.trim(), query, search_depth: 'basic', max_results: Math.min(this.options.maxResultsPerQuery ?? 5, 5), include_answer: false, include_raw_content: false }),
          signal: controller.signal,
        });
        if (response.status === 429) {
          const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
          recordResult({ provider: 'TAVILY', outcome: 'RATE_LIMITED_429', ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) });
          throw new EnrichmentError('Tavily rate limit reached', 'TAVILY_RATE_LIMITED', retryAfterSeconds);
        }
        if ([502, 503, 504].includes(response.status)) {
          recordResult({ provider: 'TAVILY', outcome: 'FAILED' });
          throw new EnrichmentError(`Tavily responded with ${response.status}`, 'SOURCE_TEMPORARILY_UNAVAILABLE');
        }
        if (!response.ok) {
          recordResult({ provider: 'TAVILY', outcome: 'FAILED' });
          throw new EnrichmentError(`Tavily responded with ${response.status}`, 'INVALID_SOURCE_RESPONSE');
        }
        const payload = await response.json() as { results?: unknown };
        if (!Array.isArray(payload.results)) {
          recordResult({ provider: 'TAVILY', outcome: 'FAILED' });
          throw new EnrichmentError('Tavily response is malformed', 'INVALID_SOURCE_RESPONSE');
        }
        recordResult({ provider: 'TAVILY', outcome: 'SUCCESS' });
        return payload.results as TavilyResult[];
      } catch (error) {
        if (!resultRecorded) recordResult({ provider: 'TAVILY', outcome: 'FAILED' });
        lastError = error;
        if (error instanceof EnrichmentError && error.code === 'TAVILY_RATE_LIMITED') {
          const maxWaitMs = Math.max(0, this.options.rateLimitRecoveryMaxWaitMs ?? 0);
          if (attempt < maxRetries && error.retryAfterSeconds !== undefined && maxWaitMs > 0) {
            await this.sleepFn(Math.min(error.retryAfterSeconds * 1_000, maxWaitMs));
            continue;
          }
          throw error;
        }
        if (error instanceof EnrichmentError && error.code === 'INVALID_SOURCE_RESPONSE') throw error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < maxRetries) await this.sleepFn(Math.min(500 * 2 ** attempt, 4_000));
    }
    throw lastError instanceof EnrichmentError ? lastError : new EnrichmentError('Tavily is temporarily unavailable', 'SOURCE_TEMPORARILY_UNAVAILABLE');
  }
}

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const nestedText = (value: unknown, ...keys: string[]): string | null => {
  let current: unknown = value;
  for (const key of keys) current = asRecord(current)[key];
  const text = safeText(current);
  return text || null;
};

const parseRegistryPayload = (payload: unknown, cnpj: string, sourceLocator: string, observedAt: Date): BusinessRegistryRecord => {
  const root = asRecord(payload);
  const establishment = asRecord(root.estabelecimento ?? root);
  const responseCnpj = normalizeCnpj(nestedText(establishment, 'cnpj') ?? nestedText(root, 'cnpj') ?? '');
  const businessName = nestedText(root, 'razao_social') ?? nestedText(establishment, 'razao_social') ?? '';
  const status = normalizeText(nestedText(establishment, 'situacao_cadastral') ?? nestedText(root, 'situacao_cadastral'));
  if (!isValidCnpj(responseCnpj) || responseCnpj !== cnpj || businessName === '' || status === '') {
    throw new EnrichmentError('CNPJ.ws response is incompatible with the registry schema', 'INVALID_SOURCE_RESPONSE');
  }
  const address = [
    nestedText(establishment, 'tipo_logradouro'), nestedText(establishment, 'logradouro'), nestedText(establishment, 'numero'),
    nestedText(establishment, 'complemento'), nestedText(establishment, 'bairro'), nestedText(establishment, 'cep'),
  ].filter(Boolean).join(', ') || null;
  const city = nestedText(establishment, 'cidade', 'nome') ?? nestedText(establishment, 'municipio', 'nome') ?? nestedText(establishment, 'cidade');
  const state = nestedText(establishment, 'estado', 'sigla') ?? nestedText(establishment, 'uf') ?? nestedText(establishment, 'estado');
  const statusDateText = nestedText(establishment, 'data_situacao_cadastral') ?? nestedText(root, 'data_situacao_cadastral');
  const statusDate = statusDateText ? new Date(statusDateText) : null;
  return {
    cnpj: responseCnpj,
    businessName,
    tradeName: nestedText(establishment, 'nome_fantasia') ?? nestedText(root, 'nome_fantasia'),
    registrationStatus: status === 'ativa' || status === 'active' ? 'ACTIVE' : status ? 'INACTIVE' : 'UNKNOWN',
    registrationStatusDate: statusDate && !Number.isNaN(statusDate.valueOf()) ? statusDate : null,
    address,
    city,
    state,
    postalCode: nestedText(establishment, 'cep'),
    phone: nestedText(establishment, 'telefone1') ?? nestedText(establishment, 'ddd_telefone_1') ?? nestedText(root, 'telefone'),
    email: nestedText(establishment, 'email') ?? nestedText(root, 'email'),
    website: nestedText(establishment, 'website') ?? nestedText(root, 'website'),
    activity: nestedText(establishment, 'atividade_principal', 'descricao') ?? nestedText(root, 'atividade'),
    sourceLocator,
    observedAt,
  };
};

export class CnpjWsBusinessRegistryProvider implements BusinessRegistryProvider {
  readonly name = 'cnpj-ws-business-registry';
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private lastRequestAt = 0;

  constructor(private readonly options: CnpjWsBusinessRegistryProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn = options.sleepFn ?? sleep;
    this.now = options.now ?? (() => new Date());
  }

  async lookup(value: string): Promise<BusinessRegistryRecord> {
    const cnpj = normalizeCnpj(value);
    if (!isValidCnpj(cnpj)) throw new EnrichmentError('Invalid CNPJ candidate', 'INVALID_SOURCE_RESPONSE');
    const locator = `${CNPJ_WS_ENDPOINT}/${cnpj}`;
    let lastError: unknown;
    const maxRetries = Math.min(this.options.maxRetries ?? 1, 2);
    // The public CNPJ.ws API documents a hard limit of three requests per minute per IP.
    // Keep the adapter fail-safe even if a caller supplies a larger value.
    const rpm = Math.max(1, Math.min(this.options.maxRpm ?? 3, 3));
    const minIntervalMs = Math.ceil(60_000 / rpm);
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < minIntervalMs) await this.sleepFn(minIntervalMs - elapsed);
      this.lastRequestAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      this.options.onCall?.({ provider: 'CNPJ_WS', outcome: 'ATTEMPT' });
      let resultRecorded = false;
      const recordResult = (event: ProviderCallTelemetry): void => {
        resultRecorded = true;
        this.options.onCall?.(event);
      };
      try {
        const response = await this.fetchFn(locator, { method: 'GET', headers: { accept: 'application/json', 'user-agent': 'lead-finder-sem-site/0.1' }, signal: controller.signal });
        if (response.status === 429) {
          const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
          recordResult({ provider: 'CNPJ_WS', outcome: 'RATE_LIMITED_429', ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) });
          throw new EnrichmentError('CNPJ.ws rate limit reached', 'CNPJ_WS_RATE_LIMITED', retryAfterSeconds);
        }
        if (response.status === 404) {
          recordResult({ provider: 'CNPJ_WS', outcome: 'FAILED' });
          throw new EnrichmentError('CNPJ.ws record was not found', 'REGISTRY_NOT_FOUND');
        }
        if ([502, 503, 504].includes(response.status)) {
          recordResult({ provider: 'CNPJ_WS', outcome: 'FAILED' });
          throw new EnrichmentError(`CNPJ.ws responded with ${response.status}`, 'SOURCE_TEMPORARILY_UNAVAILABLE');
        }
        if (!response.ok) {
          recordResult({ provider: 'CNPJ_WS', outcome: 'FAILED' });
          throw new EnrichmentError(`CNPJ.ws responded with ${response.status}`, 'INVALID_SOURCE_RESPONSE');
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          recordResult({ provider: 'CNPJ_WS', outcome: 'FAILED' });
          throw new EnrichmentError('CNPJ.ws response is not valid JSON', 'INVALID_SOURCE_RESPONSE');
        }
        const record = parseRegistryPayload(payload, cnpj, locator, this.now());
        if (record.cnpj !== cnpj) {
          recordResult({ provider: 'CNPJ_WS', outcome: 'FAILED' });
          throw new EnrichmentError('CNPJ.ws returned a different company identifier', 'INVALID_SOURCE_RESPONSE');
        }
        recordResult({ provider: 'CNPJ_WS', outcome: 'SUCCESS' });
        return record;
      } catch (error) {
        if (!resultRecorded) recordResult({ provider: 'CNPJ_WS', outcome: 'FAILED' });
        lastError = error;
        if (error instanceof EnrichmentError && ['CNPJ_WS_RATE_LIMITED', 'REGISTRY_NOT_FOUND', 'INVALID_SOURCE_RESPONSE'].includes(error.code)) throw error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < maxRetries) await this.sleepFn(Math.min(500 * 2 ** attempt, 4_000));
    }
    throw lastError instanceof EnrichmentError ? lastError : new EnrichmentError('CNPJ.ws is temporarily unavailable', 'SOURCE_TEMPORARILY_UNAVAILABLE');
  }
}

const nameTokens = (value: string | null | undefined): Set<string> => new Set(normalizeText(value).split(' ').filter((token) => token.length > 2));
const overlap = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / Math.max(left.size, right.size);
};
const phoneKey = (value: string | null | undefined): string => normalizeDigits(value).slice(-8);
const postalKey = (value: string | null | undefined): string => normalizeDigits(value).slice(0, 8);

export interface RegistryMatch {
  decision: RegistryMatchDecision;
  score: number;
  reasons: string[];
}

export function matchRegistryToLead(lead: NormalizedLead, record: BusinessRegistryRecord): RegistryMatch {
  const leadCity = normalizeText(lead.city);
  const recordCity = normalizeText(record.city);
  const leadState = normalizeText(lead.state);
  const recordState = normalizeText(record.state);
  const nameScore = normalizeText(lead.name) === normalizeText(record.tradeName ?? record.businessName) && normalizeText(lead.name) !== ''
    ? 4 : overlap(nameTokens(lead.name), nameTokens(record.tradeName ?? record.businessName)) >= 0.6 ? 3 : 0;
  const cityMatch = leadCity !== '' && leadCity === recordCity;
  let score = nameScore + (cityMatch ? 3 : 0) + (leadState !== '' && leadState === recordState ? 1 : 0);
  const reasons: string[] = [];
  if (nameScore > 0) reasons.push('NAME_MATCH');
  if (cityMatch) reasons.push('CITY_MATCH');
  if (leadState !== '' && leadState === recordState) reasons.push('STATE_MATCH');
  if (phoneKey(lead.phone) !== '' && phoneKey(lead.phone) === phoneKey(record.phone)) { score += 2; reasons.push('PHONE_MATCH'); }
  if (postalKey(lead.address) !== '' && postalKey(lead.address) === postalKey(record.postalCode)) { score += 1; reasons.push('POSTAL_MATCH'); }
  if (overlap(nameTokens(lead.address), nameTokens(record.address)) >= 0.5) { score += 2; reasons.push('ADDRESS_MATCH'); }
  if (!cityMatch || nameScore === 0) return { decision: 'REJECTED', score, reasons };
  const stableBusinessSignal = reasons.some((reason) => ['PHONE_MATCH', 'ADDRESS_MATCH', 'POSTAL_MATCH'].includes(reason));
  return { decision: score >= 6 && stableBusinessSignal ? 'CONFIRMED' : 'AMBIGUOUS', score, reasons };
}

export interface CompositeBusinessEnrichmentProviderOptions {
  searchProvider: WebSearchEvidenceProvider;
  registryProvider: BusinessRegistryProvider;
}

export class CompositeBusinessEnrichmentProvider implements BusinessContactEnrichmentProvider {
  readonly name = 'composite-public-enrichment';

  constructor(private readonly options: CompositeBusinessEnrichmentProviderOptions) {}

  async enrich(request: BusinessEnrichmentRequest): Promise<BusinessEnrichmentResult> {
    const search = await this.options.searchProvider.search(request);
    const records: Array<{ record: BusinessRegistryRecord; score: number }> = [];
    let ambiguousMatch = false;
    for (const cnpj of search.cnpjCandidates.slice(0, MAX_CNPJ_CANDIDATES)) {
      let record: BusinessRegistryRecord;
      try {
        record = await this.options.registryProvider.lookup(cnpj);
      } catch (error) {
        if (error instanceof EnrichmentError && error.code === 'REGISTRY_NOT_FOUND') continue;
        throw error;
      }
      const match = matchRegistryToLead(request.lead, record);
      if (match.decision === 'CONFIRMED') records.push({ record, score: match.score });
      if (match.decision === 'AMBIGUOUS') ambiguousMatch = true;
    }
    const registry = records.length === 1 && !ambiguousMatch ? records[0]!.record : null;
    const identityConfirmed = registry !== null;
    const officialSiteFound = Boolean(registry?.website && isPublicSourceLocator(registry.website)) || search.officialSiteFound;
    const websiteConfidence = identityConfirmed && !officialSiteFound && search.queryCount >= 6 && search.ambiguousDomainMatches === 0 && search.publicResultLocators.length > 0 ? 0.95 : officialSiteFound ? 0.95 : 0.4;
    const activityStatus = !registry ? 'UNCERTAIN' : registry.registrationStatus === 'INACTIVE' ? 'INACTIVE' : registry.registrationStatus === 'ACTIVE' && search.recentActivitySources.length > 0 ? 'ACTIVE' : 'UNCERTAIN';
    const activitySource = search.recentActivitySources[0] ?? { sourceLocator: search.sourceLocator, observedAt: registry?.observedAt ?? new Date(), confidence: 0.4 };
    const emails = registry?.email && isPublicSourceLocator(registry.sourceLocator)
      ? [{ value: registry.email, sourceType: 'CNPJ_WS_REGISTRY', sourceLocator: registry.sourceLocator, observedAt: registry.observedAt, businessAssociation: isBusinessEmailAddress(registry.email) ? 'PASS' as const : 'UNKNOWN' as const, inferred: false, confidence: 0.95 }]
      : search.emailCandidates.map((email) => ({ ...email, sourceType: 'TAVILY_SEARCH', observedAt: new Date(), businessAssociation: 'UNKNOWN' as const, inferred: false }));
    return {
      identity: { confirmed: identityConfirmed, sourceType: registry ? 'CNPJ_WS_REGISTRY' : 'TAVILY_SEARCH', sourceLocator: registry?.sourceLocator ?? search.sourceLocator, observedAt: registry?.observedAt ?? new Date(), confidence: identityConfirmed ? 0.95 : 0.3 },
      activity: { status: activityStatus, sourceType: registry ? 'TAVILY_SEARCH' : 'TAVILY_SEARCH', sourceLocator: activitySource.sourceLocator, observedAt: activitySource.observedAt, confidence: activityStatus === 'ACTIVE' ? activitySource.confidence : 0.4 },
      website: { officialSiteFound, sourceType: registry?.website ? 'CNPJ_WS_REGISTRY' : 'TAVILY_SEARCH', sourceLocator: registry?.website ?? search.sourceLocator, observedAt: registry?.observedAt ?? new Date(), confidence: websiteConfidence },
      emails,
    };
  }
}
