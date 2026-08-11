import type { Category, CollectInput, NormalizedLead } from '@lead-finder/shared';

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
interface OverpassResponse {
  elements: OsmElement[];
}
const categoryFilters: Record<Category, readonly string[]> = {
  oficinas: ['["shop"="car_repair"]'],
  autoeletricas: ['["craft"="electrician"]["vehicle"="yes"]', '["shop"="car_repair"]'],
  'saloes-de-beleza': ['["shop"="beauty"]'],
  barbearias: ['["shop"="hairdresser"]["hairdresser"="barber"]', '["shop"="hairdresser"]'],
  clinicas: ['["amenity"="clinic"]'],
  consultorios: ['["amenity"="doctors"]'],
  restaurantes: ['["amenity"="restaurant"]'],
  lanchonetes: ['["amenity"="fast_food"]'],
  'empresas-de-seguranca': ['["office"="security"]', '["craft"="security"]'],
  'prestadores-de-servicos': ['["office"="company"]', '["craft"]'],
};
const websiteKeys = ['website', 'contact:website', 'url'] as const;
const get = (tags: Record<string, string>, ...keys: string[]) =>
  keys.map((key) => tags[key]?.trim()).find(Boolean) ?? null;
export const hasRegisteredWebsite = (tags: Record<string, string>): boolean =>
  websiteKeys.some((key) => Boolean(tags[key]?.trim()));
const addressOf = (t: Record<string, string>): string | null => {
  const street = get(t, 'addr:street');
  const number = get(t, 'addr:housenumber');
  const district = get(t, 'addr:suburb', 'addr:district');
  const value = [street && [street, number].filter(Boolean).join(', '), district]
    .filter(Boolean)
    .join(' - ');
  return value || null;
};
export function normalizeElement(element: OsmElement, category: Category): NormalizedLead {
  const t = element.tags ?? {};
  const center = element.center;
  const lifecycle = get(t, 'disused', 'abandoned', 'closed', 'end_date');
  return {
    osmType: element.type,
    osmId: String(element.id),
    name: get(t, 'name', 'brand'),
    category,
    phone: get(t, 'contact:phone', 'phone'),
    whatsapp: get(t, 'contact:whatsapp', 'whatsapp'),
    email: get(t, 'contact:email', 'email'),
    website: get(t, 'website', 'contact:website', 'url'),
    websiteStatus: 'UNKNOWN',
    instagram: get(t, 'contact:instagram', 'instagram'),
    facebook: get(t, 'contact:facebook', 'facebook'),
    address: addressOf(t),
    city: get(t, 'addr:city'),
    state: get(t, 'addr:state'),
    latitude: element.lat ?? center?.lat ?? null,
    longitude: element.lon ?? center?.lon ?? null,
    isClosed:
      Boolean(lifecycle) ||
      ['closed', 'inactive', 'disused'].includes((t['opening_hours'] ?? '').toLowerCase()),
  };
}
const escapeArea = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
export function buildOverpassQuery(input: CollectInput): string {
  const area = `${escapeArea(input.city)}, ${escapeArea(input.state)}, ${escapeArea(input.country)}`;
  const selectors = categoryFilters[input.category]
    .flatMap((filter) =>
      ['node', 'way', 'relation'].map((type) => `${type}${filter}(area.searchArea);`),
    )
    .join('');
  return `[out:json][timeout:25];area["name"="${escapeArea(input.city)}"]->.searchArea;(${selectors});out center tags ${input.limit};/* ${area} */`;
}
export class OverpassError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code: 'SOURCE_TEMPORARILY_UNAVAILABLE' | 'INVALID_SOURCE_RESPONSE' = 'SOURCE_TEMPORARILY_UNAVAILABLE',
  ) {
    super(message);
  }
}
export interface OverpassClientOptions {
  endpoint: string;
  timeoutMs: number;
  maxRetries: number;
  fetchFn?: typeof fetch;
}
export class OverpassClient {
  private readonly fetchFn: typeof fetch;
  constructor(private readonly options: OverpassClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }
  async collect(input: CollectInput): Promise<NormalizedLead[]> {
    const query = buildOverpassQuery(input);
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await this.fetchFn(this.options.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'lead-finder-sem-site/0.1',
          },
          body: new URLSearchParams({ data: query }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new OverpassError(
            `Overpass responded with ${response.status}`,
            response.status,
            [429, 502, 504].includes(response.status)
              ? 'SOURCE_TEMPORARILY_UNAVAILABLE'
              : 'INVALID_SOURCE_RESPONSE',
          );
          if (![429, 502, 504].includes(response.status)) throw error;
          lastError = error;
        } else {
          const data = (await response.json()) as OverpassResponse;
          return data.elements
            .map((e) => normalizeElement(e, input.category))
            .filter((lead) => !lead.website)
            .slice(0, input.limit);
        }
      } catch (error) {
        lastError = error;
        if (
          error instanceof OverpassError &&
          error.status &&
          ![429, 502, 504].includes(error.status)
        )
          throw error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.options.maxRetries)
        await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 4000)));
    }
    throw new OverpassError(
      `Overpass request failed after retries: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
      lastError instanceof OverpassError ? lastError.status : undefined,
      'SOURCE_TEMPORARILY_UNAVAILABLE',
    );
  }
}
