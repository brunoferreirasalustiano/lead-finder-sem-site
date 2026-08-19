import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import { hmlDaily6AuthPermissions, hmlOperatorAuthPermissions, hmlOpportunityReviewAuthPermissions } from '@lead-finder/shared';
import { buildApp } from './app.js';

const operatorToken = 'synthetic-hml-operator-token-for-cnpj-opportunity-0001';
const operatorAuth = {
  tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
  expiresAt: new Date(Date.now() + 60_000),
  principalId: 'hml-operator-cnpj-reader',
  principalPermissions: hmlOperatorAuthPermissions,
  environment: 'homologation' as const,
};
const opportunityToken = 'synthetic-hml-opportunity-review-token-for-cnpj-0001';
const opportunityAuth = {
  tokenHash: createHash('sha256').update(opportunityToken, 'utf8').digest('hex'),
  expiresAt: new Date(Date.now() + 60_000),
  principalId: 'hml-opportunity-cnpj-reader',
  principalPermissions: hmlOpportunityReviewAuthPermissions,
  environment: 'homologation' as const,
};
const daily6Token = 'synthetic-hml-daily6-token-for-cnpj-opportunity-0001';
const daily6Auth = {
  tokenHash: createHash('sha256').update(daily6Token, 'utf8').digest('hex'),
  expiresAt: new Date(Date.now() + 60_000),
  principalId: 'hml-daily6-cnpj-reader',
  principalPermissions: hmlDaily6AuthPermissions,
  environment: 'homologation' as const,
};
const row = {
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
  cnpj: '12345678000195',
  cnpj_opening_date: '2026-01-02',
  cnpj_registration_status: 'ACTIVE',
  cnpj_source: 'OFFICIAL_REGISTRY',
};

describe('DailyWhatsApp CNPJ opportunity route', () => {
  it('is disabled by default and never calls the resolver', async () => {
    const list = vi.fn().mockResolvedValue([row]);
    const app = buildApp({} as Database, {
      authentication: { operatorTemporary: operatorAuth, opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDailyWhatsappRecentCnpjOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/dailywhatsapp/cnpj-opportunities?openedSince=2026-01-01',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(404);
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns only bounded manual-review data through the operator gate', async () => {
    const list = vi.fn().mockResolvedValue([row]);
    const app = buildApp({} as Database, {
      whatsappOpportunityReviewEnabled: true,
      authentication: { operatorTemporary: operatorAuth, opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDailyWhatsappRecentCnpjOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/dailywhatsapp/cnpj-opportunities?city=Campinas&openedSince=2026-01-01&limit=30',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      total: 1,
      limit: 30,
      manualReviewOnly: true,
      cnpjRecentEvidenceRequired: true,
      items: [{ cnpj: '12345678000195', cnpjOpeningDate: '2026-01-02', manualReviewOnly: true }],
    });
    const body: { items: Array<Record<string, unknown>> } = response.json();
    expect(body.items[0]).not.toHaveProperty('sourceLocator');
    expect(body.items[0]).not.toHaveProperty('fingerprint');
    expect(body.items[0]).not.toHaveProperty('rawEvidence');
    expect(list).toHaveBeenCalledWith(expect.anything(), {
      city: 'Campinas',
      openedSince: '2026-01-01',
      limit: 30,
    });
    await app.close();
  });

  it('fails closed when the resolver exceeds the public response bound', async () => {
    const list = vi.fn().mockResolvedValue(Array.from({ length: 31 }, () => row));
    const app = buildApp({} as Database, {
      whatsappOpportunityReviewEnabled: true,
      authentication: { opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDailyWhatsappRecentCnpjOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/dailywhatsapp/cnpj-opportunities?openedSince=2026-01-01&limit=30',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service unavailable', code: 'OPPORTUNITY_RESULT_OVER_LIMIT' });
    await app.close();
  });

  it('rejects invalid recency input before querying', async () => {
    const list = vi.fn().mockResolvedValue([row]);
    const app = buildApp({} as Database, {
      whatsappOpportunityReviewEnabled: true,
      authentication: { opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDailyWhatsappRecentCnpjOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/dailywhatsapp/cnpj-opportunities?openedSince=not-a-date',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(400);
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });

  it('sanitizes resolver failures without exposing database details', async () => {
    const list = vi.fn().mockRejectedValue(new Error('sensitive database connection detail'));
    const app = buildApp({} as Database, {
      whatsappOpportunityReviewEnabled: true,
      authentication: { opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDailyWhatsappRecentCnpjOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/dailywhatsapp/cnpj-opportunities?openedSince=2026-01-01',
      headers: { authorization: `Bearer ${opportunityToken}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service unavailable', code: 'DATABASE_UNAVAILABLE' });
    expect(response.body).not.toContain('sensitive database connection detail');
    await app.close();
  });

  it('denies the broad operator bearer and never invokes the resolver', async () => {
    const list = vi.fn().mockResolvedValue([row]);
    const app = buildApp({} as Database, {
      whatsappOpportunityReviewEnabled: true,
      authentication: { operatorTemporary: operatorAuth, opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDailyWhatsappRecentCnpjOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/dailywhatsapp/cnpj-opportunities?openedSince=2026-01-01',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });

  it('denies the Daily-6 scheduler bearer and never invokes the resolver', async () => {
    const list = vi.fn().mockResolvedValue([row]);
    const app = buildApp({} as Database, {
      whatsappOpportunityReviewEnabled: true,
      authentication: { daily6Temporary: daily6Auth, operatorTemporary: operatorAuth, opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDailyWhatsappRecentCnpjOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/dailywhatsapp/cnpj-opportunities?openedSince=2026-01-01',
      headers: { authorization: `Bearer ${daily6Token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects unauthenticated callers without invoking the resolver', async () => {
    const list = vi.fn().mockResolvedValue([row]);
    const app = buildApp({} as Database, {
      whatsappOpportunityReviewEnabled: true,
      authentication: { operatorTemporary: operatorAuth, opportunityReviewTemporary: opportunityAuth },
      contractQueries: { listDailyWhatsappRecentCnpjOpportunities: list },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/dailywhatsapp/cnpj-opportunities?openedSince=2026-01-01',
    });
    expect(response.statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });
});
