import { describe, expect, it, vi } from 'vitest';
import {
  classifyWebsite,
  EnrichmentError,
  HttpBusinessEnrichmentProvider,
  isReadyForHumanReview,
  hasVerifiedBusinessEmail,
  isBusinessEmailAddress,
  isPublicSourceLocator,
  type BusinessEnrichmentResult,
} from './index.js';

const base: BusinessEnrichmentResult = {
  identity: { confirmed: true, sourceType: 'PUBLIC_BUSINESS_SOURCE', sourceLocator: 'https://source.test/business', observedAt: new Date(), confidence: 0.95 },
  activity: { status: 'ACTIVE' as const, sourceType: 'PUBLIC_BUSINESS_SOURCE', sourceLocator: 'https://source.test/activity', observedAt: new Date(), confidence: 0.9 },
  website: { officialSiteFound: false, sourceType: 'PUBLIC_BUSINESS_SOURCE', sourceLocator: 'https://source.test/search', observedAt: new Date(), confidence: 0.95 },
  emails: [{ value: 'office@example.test', sourceType: 'PUBLIC_BUSINESS_SOURCE', sourceLocator: 'https://source.test/contact', observedAt: new Date(), businessAssociation: 'PASS' as const, inferred: false, confidence: 0.95 }],
};

describe('enrichment contracts', () => {
  it('does not classify missing/uncertain website evidence as no-site confirmed', () => {
    expect(classifyWebsite({ website: { ...base.website, confidence: 0.5 } })).toBe('UNKNOWN');
  });

  it('requires public non-inferred business email and active no-site evidence', () => {
    expect(hasVerifiedBusinessEmail(base)).toBe(true);
    expect(isReadyForHumanReview(base)).toBe(true);
    expect(isReadyForHumanReview({ ...base, activity: { ...base.activity, status: 'UNCERTAIN' } })).toBe(false);
    expect(isReadyForHumanReview({ ...base, emails: [{ ...base.emails[0]!, inferred: true }] })).toBe(false);
  });

  it('maps an official domain to a rejection state', () => {
    expect(classifyWebsite({ website: { ...base.website, officialSiteFound: true } })).toBe('OFFICIAL_SITE_FOUND');
  });

  it('requires public evidence and rejects inferred or personal-only contacts', () => {
    expect(isPublicSourceLocator('https://source.test/contact')).toBe(true);
    expect(isPublicSourceLocator('file:///tmp/private')).toBe(false);
    expect(hasVerifiedBusinessEmail({ emails: [{ ...base.emails[0]!, sourceLocator: 'file:///tmp/private' }] })).toBe(false);
    expect(hasVerifiedBusinessEmail({ emails: [{ ...base.emails[0]!, businessAssociation: 'UNKNOWN' }] })).toBe(false);
    expect(isPublicSourceLocator('http://127.0.0.1/internal')).toBe(false);
    expect(isPublicSourceLocator('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isPublicSourceLocator('http://localhost:8080/internal')).toBe(false);
    expect(isBusinessEmailAddress('contato@business.example')).toBe(true);
    expect(isBusinessEmailAddress('owner@gmail.com')).toBe(false);
  });

  it('requires high-confidence evidence before human review', () => {
    expect(isReadyForHumanReview({ ...base, identity: { ...base.identity, confidence: 0.5 } })).toBe(false);
    expect(isReadyForHumanReview({ ...base, activity: { ...base.activity, confidence: 0.5 } })).toBe(false);
    expect(isReadyForHumanReview({ ...base, emails: [{ ...base.emails[0]!, confidence: 0.5 }] })).toBe(false);
  });

  it('classifies 504 as temporary source unavailability without treating it as empty', async () => {
    const provider = new HttpBusinessEnrichmentProvider({
      endpoint: 'https://enrichment.test', timeoutMs: 100, maxRetries: 0,
      fetchFn: vi.fn().mockResolvedValue(new Response('', { status: 504 })),
    });
    await expect(provider.enrich({ lead: { osmType: 'node', osmId: '1', name: 'X', category: 'saloes-de-beleza', phone: null, whatsapp: null, email: null, website: null, instagram: null, facebook: null, address: null, city: 'Campinas', state: 'SP', latitude: null, longitude: null, isClosed: false } })).rejects.toMatchObject({ code: 'SOURCE_TEMPORARILY_UNAVAILABLE' } satisfies Partial<EnrichmentError>);
  });

  it('classifies malformed successful responses as invalid source data', async () => {
    const provider = new HttpBusinessEnrichmentProvider({
      endpoint: 'https://enrichment.test', timeoutMs: 100, maxRetries: 0,
      fetchFn: vi.fn().mockResolvedValue(new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })),
    });
    await expect(provider.enrich({ lead: { osmType: 'node', osmId: '2', name: 'X', category: 'saloes-de-beleza', phone: null, whatsapp: null, email: null, website: null, instagram: null, facebook: null, address: null, city: 'Campinas', state: 'SP', latitude: null, longitude: null, isClosed: false } })).rejects.toMatchObject({ code: 'INVALID_SOURCE_RESPONSE' });
  });
});
