import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import { hmlDaily6AuthPermissions, hmlOpportunityReviewAuthPermissions, hmlOperatorAuthPermissions } from '@lead-finder/shared';
import { buildApp } from './app.js';
import { permissions } from './auth.js';

const apiToken = 'synthetic-api-token-for-whatsapp-opportunity-0001';
const hmlToken = 'synthetic-hml-daily6-token-for-whatsapp-opportunity-0001';
const hmlAuth = {
  tokenHash: createHash('sha256').update(hmlToken, 'utf8').digest('hex'),
  expiresAt: new Date(Date.now() + 60_000),
  principalId: 'hml-daily6-whatsapp-reader',
  principalPermissions: hmlDaily6AuthPermissions,
  environment: 'homologation' as const,
};
const operatorToken = 'synthetic-hml-operator-token-for-whatsapp-opportunity-0001';
const operatorAuth = {
  tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
  expiresAt: new Date(Date.now() + 60_000),
  principalId: 'hml-operator-whatsapp-reader',
  principalPermissions: hmlOperatorAuthPermissions,
  environment: 'homologation' as const,
};
const opportunityToken = 'synthetic-hml-opportunity-review-token-for-whatsapp-0001';
const opportunityAuth = {
  tokenHash: createHash('sha256').update(opportunityToken, 'utf8').digest('hex'),
  expiresAt: new Date(Date.now() + 60_000),
  principalId: 'hml-opportunity-whatsapp-reader',
  principalPermissions: hmlOpportunityReviewAuthPermissions,
  environment: 'homologation' as const,
};

const rows = [{
  lead_id: '10dfeb9d-30f0-4d5a-8762-3dbb4ed506aa',
  contact_id: '20dfeb9d-30f0-4d5a-8762-3dbb4ed506ab',
  lead_name: 'Empresa de teste',
  city: 'Campinas',
  category: 'oficinas',
  whatsapp_value: '+5519999999999',
  whatsapp_source: 'PUBLIC_DIRECTORY',
  whatsapp_evidence: 'LEAD_WHATSAPP_FIELD' as const,
  website_status: 'UNKNOWN',
  qualification_status: 'PENDENTE',
  business_identity_confirmed: false,
  business_active_pass: true,
}];

describe('Daily-6 WhatsApp opportunity route', () => {
  it('is disabled by default even when the operator bearer exists', async () => {
    const list = vi.fn().mockResolvedValue(rows);
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      authentication: { operatorTemporary: operatorAuth, opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDaily6WhatsappOpportunities: list },
    });
    await expect(app.inject({
      method: 'GET',
      url: '/internal/daily6/whatsapp-opportunities',
      headers: { authorization: `Bearer ${operatorToken}` },
    })).resolves.toMatchObject({ statusCode: 404 });
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });

  it('is default-deny and never calls the query without the HML bearer', async () => {
    const list = vi.fn().mockResolvedValue(rows);
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      whatsappOpportunityReviewEnabled: true,
      authentication: {
        token: apiToken,
        principalPermissions: permissions,
        daily6Temporary: hmlAuth,
        operatorTemporary: operatorAuth,
        opportunityReviewTemporary: opportunityAuth,
      },
      contractQueries: { listDaily6WhatsappOpportunities: list },
    });

    await expect(app.inject({ method: 'GET', url: '/internal/daily6/whatsapp-opportunities' }))
      .resolves.toMatchObject({ statusCode: 401 });
    await expect(app.inject({
      method: 'GET',
      url: '/internal/daily6/whatsapp-opportunities',
      headers: { authorization: `Bearer ${apiToken}` },
    })).resolves.toMatchObject({ statusCode: 403 });
    await expect(app.inject({
      method: 'GET',
      url: '/internal/daily6/whatsapp-opportunities',
      headers: { authorization: `Bearer ${hmlToken}` },
    })).resolves.toMatchObject({ statusCode: 403 });
    await expect(app.inject({
      method: 'GET',
      url: '/internal/daily6/whatsapp-opportunities',
      headers: { authorization: `Bearer ${operatorToken}` },
    })).resolves.toMatchObject({ statusCode: 403 });
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns at most 30 manual-review records and does not send or persist', async () => {
    const list = vi.fn().mockResolvedValue(rows);
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      whatsappOpportunityReviewEnabled: true,
      authentication: {
        token: apiToken,
        principalPermissions: permissions,
        daily6Temporary: hmlAuth,
        operatorTemporary: operatorAuth,
        opportunityReviewTemporary: opportunityAuth,
      },
      contractQueries: { listDaily6WhatsappOpportunities: list },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/daily6/whatsapp-opportunities?city=Campinas&limit=30',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      total: 1,
      manualReviewOnly: true,
      items: [{
        businessName: 'Empresa de teste',
        whatsapp: '+5519999999999',
        manualReviewOnly: true,
        opportunityState: 'WHATSAPP_REVIEW_REQUIRED',
      }],
    });
    expect(list).toHaveBeenCalledWith(expect.anything(), { city: 'Campinas', limit: 30 });
    await app.close();
  });

  it('supports an exactly 30-row synthetic review batch without any send path', async () => {
    const thirtyRows = Array.from({ length: 30 }, (_, index) => ({
      ...rows[0]!,
      lead_id: `10dfeb9d-30f0-4d5a-8762-3dbb4ed50${String(index).padStart(2, '0')}`,
      whatsapp_value: `+551999999${String(1000 + index).slice(-4)}`,
    }));
    const list = vi.fn().mockResolvedValue(thirtyRows);
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      whatsappOpportunityReviewEnabled: true,
      authentication: { operatorTemporary: operatorAuth, opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDaily6WhatsappOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/daily6/whatsapp-opportunities?city=Campinas&limit=30',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body: { total: number; limit: number; manualReviewOnly: boolean; items: unknown[] } = response.json();
    expect(body).toMatchObject({ total: 30, limit: 30, manualReviewOnly: true });
    expect(body.items).toHaveLength(30);
    expect(list).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('fails closed if a query implementation violates the response bound', async () => {
    const overLimit = Array.from({ length: 31 }, (_, index) => ({
      ...rows[0]!,
      lead_id: `10dfeb9d-30f0-4d5a-8762-3dbb4ed50${String(index).padStart(2, '0')}`,
    }));
    const list = vi.fn().mockResolvedValue(overLimit);
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      whatsappOpportunityReviewEnabled: true,
      authentication: { operatorTemporary: operatorAuth, opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDaily6WhatsappOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/daily6/whatsapp-opportunities?limit=30',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service unavailable', code: 'OPPORTUNITY_RESULT_OVER_LIMIT' });
    await app.close();
  });
});
