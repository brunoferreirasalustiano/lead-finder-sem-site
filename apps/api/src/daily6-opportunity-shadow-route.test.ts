import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database, Daily6OpportunityShadowRow } from '@lead-finder/database';
import { hmlDaily6AuthPermissions, hmlOpportunityReviewAuthPermissions, hmlOperatorAuthPermissions, type ApiAuthPermission } from '@lead-finder/shared';
import { buildApp } from './app.js';
import { permissions } from './auth.js';

const apiToken = 'synthetic-api-token-for-opportunity-shadow-0001';
const daily6Token = 'synthetic-hml-daily6-token-for-opportunity-shadow-0001';
const operatorToken = 'synthetic-hml-operator-token-for-opportunity-shadow-0001';
const opportunityToken = 'synthetic-hml-opportunity-review-token-for-shadow-0001';
const auth = (token: string, principalId: string, principalPermissions: readonly ApiAuthPermission[]) => ({
  tokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
  expiresAt: new Date(Date.now() + 60_000),
  principalId,
  principalPermissions,
  environment: 'homologation' as const,
});
const daily6Auth = auth(daily6Token, 'hml-daily6-opportunity-shadow', hmlDaily6AuthPermissions);
const operatorAuth = auth(operatorToken, 'hml-operator-opportunity-shadow', hmlOperatorAuthPermissions);
const opportunityAuth = auth(opportunityToken, 'hml-opportunity-shadow', hmlOpportunityReviewAuthPermissions);

const candidate: Daily6OpportunityShadowRow = {
  lead_id: '10dfeb9d-30f0-4d5a-8762-3dbb4ed506aa',
  city: 'Campinas',
  category: 'oficinas',
  identity_state: 'CONFIRMED',
  activity_state: 'ACTIVE',
  email_state: 'PASS',
  website_state: 'NO_OFFICIAL_SITE_CONFIRMED',
  lead_blocked: false,
  business_closed: false,
  prior_contact: false,
  duplicate: false,
  pending_or_ambiguous_send: false,
  suppressed: false,
  hard_bounce: false,
  opt_out: false,
  do_not_contact: false,
  nao_contatar: false,
  email_channel_allowed: true,
  current_evidence_present: true,
  legacy_status_only: false,
};

type BuildAppOptions = NonNullable<Parameters<typeof buildApp>[1]>;
type OpportunityShadowResolver = NonNullable<
  NonNullable<BuildAppOptions['contractQueries']>['listDaily6OpportunityShadow']
>;
const buildTestApp = (list: ReturnType<typeof vi.fn>, overrides: Partial<BuildAppOptions> = {}) => buildApp({} as Database, {
  daily6OpportunityShadowEnabled: true,
  authentication: {
    token: apiToken,
    principalPermissions: permissions,
    daily6Temporary: daily6Auth,
    operatorTemporary: operatorAuth,
    opportunityReviewTemporary: opportunityAuth,
  },
  contractQueries: { listDaily6OpportunityShadow: list as unknown as OpportunityShadowResolver },
  ...overrides,
});

describe('Daily-6 opportunity shadow route', () => {
  it('is disabled by default and does not query even with dedicated auth', async () => {
    const list = vi.fn().mockResolvedValue([candidate]);
    const app = buildApp({} as Database, {
      authentication: { opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDaily6OpportunityShadow: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/daily6/opportunity-shadow',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(404);
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });

  it('requires the dedicated opportunity-review source and never queries for other principals', async () => {
    const list = vi.fn().mockResolvedValue([candidate]);
    const app = buildTestApp(list);
    await expect(app.inject({ method: 'GET', url: '/internal/daily6/opportunity-shadow' }))
      .resolves.toMatchObject({ statusCode: 401 });
    for (const token of [apiToken, daily6Token, operatorToken]) {
      await expect(app.inject({
        method: 'GET',
        url: '/internal/daily6/opportunity-shadow',
        headers: { authorization: `Bearer ${token}` },
      })).resolves.toMatchObject({ statusCode: 403 });
    }
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns only bounded, manual-review, PII-free shadow data', async () => {
    const list = vi.fn().mockResolvedValue([candidate]);
    const response = await buildTestApp(list).inject({
      method: 'GET',
      url: '/internal/daily6/opportunity-shadow?city=Campinas&limit=30',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<Record<string, unknown>>();
    expect(body).toMatchObject({ sampleTotal: 1, limit: 30, manualReviewOnly: true, autoSendAllowed: false });
    expect(body.sampleStateCounts).toEqual({ OPPORTUNITY_READY: 1 });
    expect(body.sampleReasonCounts).toEqual({});
    expect(body).not.toHaveProperty('total');
    expect(body).not.toHaveProperty('stateCounts');
    expect(body).not.toHaveProperty('reasonCounts');
    const item = (body.items as Array<Record<string, unknown>>)[0]!;
    expect(item).toEqual({
      leadId: candidate.lead_id,
      city: 'Campinas',
      category: 'oficinas',
      evidenceStates: {
        identity: 'CONFIRMED',
        activity: 'ACTIVE',
        email: 'PASS',
        website: 'NO_OFFICIAL_SITE_CONFIRMED',
      },
      opportunityState: 'OPPORTUNITY_READY',
      reasons: [],
    });
    expect(item).not.toHaveProperty('contactId');
    expect(item).not.toHaveProperty('email');
    expect(item).not.toHaveProperty('phone');
    expect(item).not.toHaveProperty('evidenceIds');
    expect(list).toHaveBeenCalledWith(expect.anything(), { city: 'Campinas', limit: 30 });
  });

  it('routes unknown evidence to review without granting auto-send', async () => {
    const list = vi.fn().mockResolvedValue([{
      ...candidate,
      identity_state: 'UNKNOWN',
      activity_state: 'UNKNOWN',
      email_state: 'UNKNOWN',
      website_state: 'UNKNOWN',
    }]);
    const response = await buildTestApp(list).inject({
      method: 'GET',
      url: '/internal/daily6/opportunity-shadow',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      manualReviewOnly: true,
      autoSendAllowed: false,
      sampleStateCounts: { REVIEW_REQUIRED: 1 },
      sampleReasonCounts: {
        IDENTITY_UNKNOWN: 1,
        BUSINESS_ACTIVITY_UNKNOWN: 1,
        EMAIL_UNKNOWN: 1,
        WEBSITE_UNKNOWN: 1,
      },
    });
  });

  it('routes missing email to review even when the email channel is allowed', async () => {
    const list = vi.fn().mockResolvedValue([{ ...candidate, email_state: 'MISSING', email_channel_allowed: true }]);
    const response = await buildTestApp(list).inject({
      method: 'GET',
      url: '/internal/daily6/opportunity-shadow',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sampleStateCounts: { REVIEW_REQUIRED: 1 },
      sampleReasonCounts: { EMAIL_MISSING: 1 },
      autoSendAllowed: false,
    });
  });

  it('keeps explicitly unsuitable email evidence reviewable without enabling send', async () => {
    const list = vi.fn().mockResolvedValue([{ ...candidate, email_state: 'UNSUITABLE' }]);
    const response = await buildTestApp(list).inject({
      method: 'GET',
      url: '/internal/daily6/opportunity-shadow',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sampleStateCounts: { REVIEW_REQUIRED: 1 },
      sampleReasonCounts: { EMAIL_UNSUITABLE: 1 },
      manualReviewOnly: true,
      autoSendAllowed: false,
    });
  });

  it('rejects invalid query before the resolver', async () => {
    const list = vi.fn().mockResolvedValue([candidate]);
    const response = await buildTestApp(list).inject({
      method: 'GET',
      url: '/internal/daily6/opportunity-shadow?limit=31',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('fails closed if the resolver exceeds the response bound', async () => {
    const list = vi.fn().mockResolvedValue(Array.from({ length: 31 }, () => candidate));
    const response = await buildTestApp(list).inject({
      method: 'GET',
      url: '/internal/daily6/opportunity-shadow?limit=30',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service unavailable', code: 'OPPORTUNITY_RESULT_OVER_LIMIT' });
  });

  it('sanitizes resolver failure and does not invoke side-effect dependencies', async () => {
    const list = vi.fn().mockRejectedValue(new Error('sensitive database detail'));
    const deliverEmail = vi.fn();
    const deliverWhatsApp = vi.fn();
    const enqueue = vi.fn();
    const process = vi.fn();
    const response = await buildTestApp(list, {
      deliverManualEmail: deliverEmail,
      deliverWhatsAppCloud: deliverWhatsApp,
      enqueueCollection: enqueue,
      processLeadBatch: process,
    }).inject({
      method: 'GET',
      url: '/internal/daily6/opportunity-shadow',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual(JSON.stringify({ error: 'Service unavailable', code: 'DATABASE_UNAVAILABLE' }));
    expect(response.body).not.toContain('sensitive database detail');
    expect(deliverEmail).not.toHaveBeenCalled();
    expect(deliverWhatsApp).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });
});
