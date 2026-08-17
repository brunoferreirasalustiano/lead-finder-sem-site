import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import { hmlDaily6AuthPermissions } from '@lead-finder/shared';
import { buildApp } from './app.js';
import { permissions } from './auth.js';

const apiToken = 'synthetic-api-token-for-opportunity-route-0001';
const hmlToken = 'synthetic-hml-daily6-token-for-opportunity-route-0001';

const hmlAuth = {
  tokenHash: createHash('sha256').update(hmlToken, 'utf8').digest('hex'),
  expiresAt: new Date(Date.now() + 60_000),
  principalId: 'hml-daily6-opportunity-reader',
  principalPermissions: hmlDaily6AuthPermissions,
  environment: 'homologation' as const,
};

const rows = [
  {
    lead_id: '10dfeb9d-30f0-4d5a-8762-3dbb4ed506aa',
    contact_id: null,
    city: 'Campinas',
    category: 'oficinas',
    business_identity_confirmed: true,
    business_active_pass: true,
    public_business_email_present: false,
    email_business_association_pass: false,
    email_inferred: false,
    official_site_found: false,
    site_search_high: true,
    prior_contact: false,
    duplicate: false,
    pending_or_ambiguous_send: false,
    suppressed: false,
    hard_bounce: false,
    opt_out: false,
    do_not_contact: false,
    nao_contatar: false,
    email_channel_allowed: true,
    current_verified_evidence_required: true,
    legacy_status_only: false,
    evidence_ids: ['evidence-1'],
  },
  {
    lead_id: '20dfeb9d-30f0-4d5a-8762-3dbb4ed506ab',
    contact_id: '30dfeb9d-30f0-4d5a-8762-3dbb4ed506ac',
    city: 'Campinas',
    category: 'oficinas',
    business_identity_confirmed: true,
    business_active_pass: true,
    public_business_email_present: true,
    email_business_association_pass: true,
    email_inferred: false,
    official_site_found: false,
    site_search_high: true,
    prior_contact: false,
    duplicate: false,
    pending_or_ambiguous_send: false,
    suppressed: false,
    hard_bounce: false,
    opt_out: false,
    do_not_contact: false,
    nao_contatar: false,
    email_channel_allowed: true,
    current_verified_evidence_required: true,
    legacy_status_only: false,
    evidence_ids: ['evidence-2'],
  },
];

describe('Daily-6 opportunity shadow route', () => {
  it('is default-deny and requires the HML Daily-6 bearer', async () => {
    const list = vi.fn().mockResolvedValue(rows);
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      authentication: {
        token: apiToken,
        principalPermissions: permissions,
        daily6Temporary: hmlAuth,
      },
      contractQueries: { listDaily6Opportunities: list },
    });

    await expect(app.inject({ method: 'GET', url: '/internal/daily6/opportunities' })).resolves.toMatchObject({ statusCode: 401 });
    await expect(app.inject({
      method: 'GET',
      url: '/internal/daily6/opportunities',
      headers: { authorization: `Bearer ${apiToken}` },
    })).resolves.toMatchObject({ statusCode: 403 });
    expect(list).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns shadow opportunity states without email or persistence data', async () => {
    const list = vi.fn().mockResolvedValue(rows);
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      authentication: {
        token: apiToken,
        principalPermissions: permissions,
        daily6Temporary: hmlAuth,
      },
      contractQueries: { listDaily6Opportunities: list },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/daily6/opportunities?city=Campinas&limit=2',
      headers: { authorization: `Bearer ${hmlToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      city: 'Campinas',
      total: 2,
      stateCounts: { OPPORTUNITY_READY: 1, SEND_ELIGIBLE: 1 },
    });
    expect(response.body).not.toMatch(/normalizedValue|contactId|lead_name|recipient|address/i);
    expect(list).toHaveBeenCalledWith(expect.anything(), { city: 'Campinas', limit: 2 });
    await app.close();
  });
});
