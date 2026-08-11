import { isIP } from 'node:net';
import { z } from 'zod';
import type { NormalizedLead } from '@lead-finder/shared';

export const websiteStatuses = [
  'UNKNOWN',
  'OFFICIAL_SITE_FOUND',
  'NO_OFFICIAL_SITE_CONFIRMED',
] as const;
export type WebsiteStatus = (typeof websiteStatuses)[number];

export const activityStatuses = ['ACTIVE', 'INACTIVE', 'UNCERTAIN'] as const;
export type ActivityStatus = (typeof activityStatuses)[number];

export const evidenceVerificationStatuses = ['VERIFIED', 'OBSERVED', 'UNVERIFIED', 'REJECTED'] as const;
export type EvidenceVerificationStatus = (typeof evidenceVerificationStatuses)[number];

export const isPublicSourceLocator = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname.length === 0 || url.username !== '' || url.password !== '') return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
    if (['localhost', 'metadata', 'metadata.google.internal'].includes(hostname)
      || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
    const ipVersion = isIP(hostname);
    if (ipVersion === 4) {
      const octets = hostname.split('.').map(Number);
      const first = octets[0] ?? -1;
      const second = octets[1] ?? -1;
      if (first === 10 || first === 127 || first === 169 && second === 254 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31) return false;
    }
    if (ipVersion === 6 && (hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd'))) return false;
    return true;
  } catch {
    return false;
  }
};

const sourceEvidenceSchema = z.object({
  sourceType: z.string().trim().min(1).max(100),
  sourceLocator: z.string().trim().min(1).max(2048).refine(isPublicSourceLocator, 'sourceLocator must be an HTTP(S) public source'),
  observedAt: z.coerce.date(),
  confidence: z.number().min(0).max(1),
});

const identitySchema = sourceEvidenceSchema.extend({
  confirmed: z.boolean(),
});

const activitySchema = sourceEvidenceSchema.extend({
  status: z.enum(activityStatuses),
});

const websiteSchema = sourceEvidenceSchema.extend({
  officialSiteFound: z.boolean(),
});

const emailSchema = sourceEvidenceSchema.extend({
  value: z.string().trim().email().max(320),
  businessAssociation: z.enum(['PASS', 'FAIL', 'UNKNOWN']),
  inferred: z.boolean(),
});

export const businessEnrichmentResultSchema = z.object({
  identity: identitySchema,
  activity: activitySchema,
  website: websiteSchema,
  emails: z.array(emailSchema).max(20),
}).strict();

export type BusinessEnrichmentResult = z.infer<typeof businessEnrichmentResultSchema>;
export const MIN_VERIFIED_EVIDENCE_CONFIDENCE = 0.85;
const consumerEmailHosts = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com']);
export const isBusinessEmailAddress = (value: string): boolean => {
  const host = value.trim().toLowerCase().split('@')[1] ?? '';
  return host !== '' && !consumerEmailHosts.has(host);
};

export type BusinessEnrichmentRequest = {
  lead: NormalizedLead;
};

export class EnrichmentError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'ENRICHMENT_EGRESS_DISABLED'
      | 'ENRICHMENT_PROVIDER_DISABLED'
      | 'SOURCE_TEMPORARILY_UNAVAILABLE'
      | 'SOURCE_RATE_LIMITED'
      | 'REGISTRY_NOT_FOUND'
      | 'INVALID_SOURCE_RESPONSE',
  ) {
    super(message);
  }
}

export interface BusinessContactEnrichmentProvider {
  readonly name: string;
  enrich(request: BusinessEnrichmentRequest): Promise<BusinessEnrichmentResult>;
}

export class DisabledBusinessEnrichmentProvider implements BusinessContactEnrichmentProvider {
  readonly name = 'disabled';

  constructor(private readonly code: 'ENRICHMENT_EGRESS_DISABLED' | 'ENRICHMENT_PROVIDER_DISABLED' = 'ENRICHMENT_EGRESS_DISABLED') {}

  enrich(): Promise<BusinessEnrichmentResult> {
    return Promise.reject(new EnrichmentError(
      this.code === 'ENRICHMENT_PROVIDER_DISABLED' ? 'Enrichment provider credential is unavailable' : 'Enrichment egress is disabled',
      this.code,
    ));
  }
}

export interface HttpBusinessEnrichmentProviderOptions {
  endpoint: string;
  timeoutMs: number;
  maxRetries: number;
  minIntervalMs?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HttpBusinessEnrichmentProvider implements BusinessContactEnrichmentProvider {
  readonly name = 'http-business-enrichment';
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private lastRequestAt = 0;

  constructor(private readonly options: HttpBusinessEnrichmentProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  async enrich(request: BusinessEnrichmentRequest): Promise<BusinessEnrichmentResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const elapsed = Date.now() - this.lastRequestAt;
      const minIntervalMs = this.options.minIntervalMs ?? 0;
      if (elapsed < minIntervalMs) await this.sleepFn(minIntervalMs - elapsed);
      this.lastRequestAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await this.fetchFn(this.options.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': 'lead-finder-sem-site/0.1' },
          body: JSON.stringify({
            osmType: request.lead.osmType,
            osmId: request.lead.osmId,
            name: request.lead.name,
            category: request.lead.category,
            city: request.lead.city,
            state: request.lead.state,
            address: request.lead.address,
            phone: request.lead.phone,
            website: request.lead.website,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          if (![429, 502, 504].includes(response.status)) {
            throw new EnrichmentError(`Enrichment provider responded with ${response.status}`, 'INVALID_SOURCE_RESPONSE');
          }
          lastError = new EnrichmentError(`Enrichment provider responded with ${response.status}`, 'SOURCE_TEMPORARILY_UNAVAILABLE');
        } else {
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            throw new EnrichmentError('Enrichment provider response is not valid JSON', 'INVALID_SOURCE_RESPONSE');
          }
          const parsed = businessEnrichmentResultSchema.safeParse(payload);
          if (!parsed.success) throw new EnrichmentError('Enrichment provider response is invalid', 'INVALID_SOURCE_RESPONSE');
          return parsed.data;
        }
      } catch (error) {
        lastError = error;
        if (error instanceof EnrichmentError && error.code === 'INVALID_SOURCE_RESPONSE') throw error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.options.maxRetries) await this.sleepFn(Math.min(500 * 2 ** attempt, 4_000));
    }
    throw lastError instanceof EnrichmentError
      ? lastError
      : new EnrichmentError('Enrichment provider is temporarily unavailable', 'SOURCE_TEMPORARILY_UNAVAILABLE');
  }
}

export function classifyWebsite(result: Pick<BusinessEnrichmentResult, 'website'>): WebsiteStatus {
  if (result.website.officialSiteFound) return 'OFFICIAL_SITE_FOUND';
  return result.website.confidence >= 0.85 ? 'NO_OFFICIAL_SITE_CONFIRMED' : 'UNKNOWN';
}

export function hasVerifiedBusinessEmail(result: Pick<BusinessEnrichmentResult, 'emails'>): boolean {
  return result.emails.some((email) => email.businessAssociation === 'PASS'
    && !email.inferred
    && isBusinessEmailAddress(email.value)
    && email.confidence >= MIN_VERIFIED_EVIDENCE_CONFIDENCE
    && isPublicSourceLocator(email.sourceLocator));
}

export function isReadyForHumanReview(result: BusinessEnrichmentResult): boolean {
  return result.identity.confirmed
    && result.identity.confidence >= MIN_VERIFIED_EVIDENCE_CONFIDENCE
    && result.activity.status === 'ACTIVE'
    && result.activity.confidence >= MIN_VERIFIED_EVIDENCE_CONFIDENCE
    && result.website.officialSiteFound === false
    && classifyWebsite(result) === 'NO_OFFICIAL_SITE_CONFIRMED'
    && result.website.confidence >= MIN_VERIFIED_EVIDENCE_CONFIDENCE
    && hasVerifiedBusinessEmail(result);
}

export * from './providers.js';
