import { describe, expect, it } from 'vitest';
import {
  assertPilotResultTransition, assertPilotRunTransition, canTransitionPilotRun, createPilotMetricSnapshot,
  evaluatePilotReadiness, pilotLeadAddSchema, pilotManualContactSchema, pilotResultSchema, pilotReviewSchema,
  pilotRunCreateSchema, pilotRunStatusChangeSchema,
} from './pilot.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
const key = 'pilot-key-0001';
const eligibleLead = {
  reviewDecision: 'APPROVED' as const, qualificationStatus: 'SEM_SITE_CONFIRMADO', websiteStatus: 'NO_OFFICIAL_SITE_CONFIRMED' as const, hasValidVerifiedContact: true,
  hasRequiredEvidence: true, isBlocked: false, doNotContact: false, hasActiveOptOut: false, crmStage: 'QUALIFICADO', versionConsistent: true,
};
const readyInput = {
  name: 'Piloto sintetico', region: 'SP', category: 'oficinas', targetLeadCount: 20, leads: [eligibleLead],
  shadowModeEnabled: true, campaignSimulated: true, realProviderConfigured: false,
  collectionEgressEnabled: false, versionConsistent: true,
};

describe('pilot shared contracts', () => {
  it('accepts a bounded creation and rejects targets outside 1..30', () => {
    expect(pilotRunCreateSchema.parse({ name: ' Piloto ', region: ' SP ', category: ' oficinas ', targetLeadCount: 20, idempotencyKey: key }))
      .toEqual({ name: 'Piloto', region: 'SP', category: 'oficinas', targetLeadCount: 20, idempotencyKey: key });
    for (const targetLeadCount of [0, 31, 1.5]) expect(() => pilotRunCreateSchema.parse({ ...readyInput, leads: undefined, targetLeadCount, idempotencyKey: key })).toThrow();
  });

  it('implements exactly the allowed run transitions and terminal states', () => {
    expect(canTransitionPilotRun('DRAFT', 'READY')).toBe(true);
    expect(canTransitionPilotRun('PAUSED', 'RUNNING')).toBe(true);
    expect(() => assertPilotRunTransition('RUNNING', 'COMPLETED')).not.toThrow();
    for (const pair of [['DRAFT', 'RUNNING'], ['COMPLETED', 'RUNNING'], ['CANCELLED', 'READY']] as const)
      expect(() => assertPilotRunTransition(pair[0], pair[1])).toThrow('is not allowed');
  });

  it.each([
    ['actor', 'forged'], ['principalId', 'forged'], ['role', 'admin'], ['permissions', ['pilot:write']],
    ['auditMetadata', { safe: true }], ['timestamp', '2030-01-01T00:00:00Z'], ['__proto__', { polluted: true }],
    ['prototype', {}], ['constructor', 'forged'],
  ])('strict commands reject untrusted %s', (field, forged) => {
    const value = Object.create(null) as Record<string, unknown>;
    Object.assign(value, { status: 'READY', expectedVersion: 0, idempotencyKey: key }); value[field] = forged;
    expect(() => pilotRunStatusChangeSchema.parse(value)).toThrow();
  });

  it('requires UUIDs, expectedVersion and idempotency where applicable', () => {
    expect(() => pilotLeadAddSchema.parse({ leadId: 'not-uuid', source: 'SYNTHETIC', expectedVersion: 0, idempotencyKey: key })).toThrow();
    expect(() => pilotLeadAddSchema.parse({ leadId: id, source: 'SYNTHETIC', idempotencyKey: key })).toThrow();
    expect(() => pilotLeadAddSchema.parse({ leadId: id, source: 'SYNTHETIC', expectedVersion: 0, idempotencyKey: 'short' })).toThrow();
  });

  it('keeps review and manual-contact audit identity server-owned', () => {
    expect(pilotReviewSchema.parse({ decision: 'APPROVED', expectedVersion: 1, idempotencyKey: key })).not.toHaveProperty('reviewerPrincipalId');
    expect(() => pilotReviewSchema.parse({ decision: 'REJECTED', expectedVersion: 1, idempotencyKey: key })).toThrow();
    expect(() => pilotManualContactSchema.parse({ contactId: id, channel: 'PHONE', approvedTemplateVersionId: 'v1', expectedVersion: 1, idempotencyKey: key, recordedAt: '2030-01-01T00:00:00Z' })).toThrow();
  });

  it('enforces structured result transitions and human conversion confirmation', () => {
    expect(() => assertPilotResultTransition('PROPOSAL_REQUESTED', 'CONVERTED')).toThrow();
    expect(() => assertPilotResultTransition('PROPOSAL_REQUESTED', 'CONVERTED', true)).not.toThrow();
    expect(() => assertPilotResultTransition('NOT_CONTACTED', 'INTERESTED', true)).toThrow();
    expect(() => pilotResultSchema.parse({ result: 'CONVERTED', expectedVersion: 1, idempotencyKey: key })).toThrow();
    expect(() => pilotResultSchema.parse({ result: 'DO_NOT_CONTACT', expectedVersion: 1, idempotencyKey: key })).toThrow();
    expect(() => pilotResultSchema.parse({ result: 'INVALID_CONTACT', reason: 'Canario invalido', expectedVersion: 1, idempotencyKey: key })).toThrow();
    expect(pilotResultSchema.parse({ result: 'INVALID_CONTACT', contactId: id, reason: 'Canario invalido', expectedVersion: 1, idempotencyKey: key }).result).toBe('INVALID_CONTACT');
    expect(() => pilotResultSchema.parse({ result: 'CONTACTED', contactId: id, expectedVersion: 1, idempotencyKey: key })).toThrow();
  });
});

describe('pilot readiness', () => {
  it('is ready only when every gate is satisfied', () => expect(evaluatePilotReadiness(readyInput)).toEqual({ ready: true, reasons: [] }));

  it('reports all relevant failures without trusting a READY snapshot', () => {
    const result = evaluatePilotReadiness({
      ...readyInput, leads: [{ ...eligibleLead, reviewDecision: null, qualificationStatus: 'PENDENTE', hasValidVerifiedContact: false,
        hasRequiredEvidence: false, isBlocked: true, doNotContact: true, hasActiveOptOut: true, crmStage: 'NAO_CONTATAR', versionConsistent: false }],
      shadowModeEnabled: false, campaignSimulated: false, realProviderConfigured: true, collectionEgressEnabled: true,
      versionConsistent: false,
    });
    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'REVIEW_NOT_APPROVED', 'QUALIFICATION_REQUIRED', 'EVIDENCE_REQUIRED', 'INVALID_CONTACT', 'LEAD_BLOCKED', 'DO_NOT_CONTACT',
      'ACTIVE_OPT_OUT', 'CRM_DO_NOT_CONTACT', 'SHADOW_MODE_DISABLED', 'CAMPAIGN_NOT_SIMULATED',
      'REAL_PROVIDER_CONFIGURED', 'COLLECTION_EGRESS_ENABLED', 'VERSION_INCONSISTENCY',
    ]));
  });

  it('rejects empty and over-target pilot sets', () => {
    expect(evaluatePilotReadiness({ ...readyInput, leads: [] }).reasons).toContain('NO_LEADS');
    expect(evaluatePilotReadiness({ ...readyInput, targetLeadCount: 1, leads: [eligibleLead, eligibleLead] }).reasons).toContain('TARGET_EXCEEDED');
  });
});

describe('pilot metrics', () => {
  const zeroCounts = {
    totalAssociated: 0, totalApproved: 0, totalRejected: 0, totalNeedsReview: 0, totalWithoutSiteConfirmed: 0,
    totalValidContacts: 0, totalManualContacts: 0, totalResponses: 0, totalInterested: 0, totalMeetingRequested: 0,
    totalProposalRequested: 0, totalConversions: 0, totalOptOuts: 0, totalInvalidContacts: 0, totalBlocked: 0, totalIncidents: 0,
  };
  it('uses explicit denominators and null for zero denominators', () => {
    const snapshot = createPilotMetricSnapshot({ period: { from: '2030-01-01T00:00:00Z', to: '2030-01-02T00:00:00Z' }, counts: zeroCounts });
    expect(snapshot.rates.approval).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(snapshot.rates.conversion.value).toBeNull();
  });
  it('calculates a reconciliable funnel and rejects PII/unknown fields', () => {
    const counts = { ...zeroCounts, totalAssociated: 20, totalApproved: 10, totalManualContacts: 8, totalResponses: 4,
      totalInterested: 2, totalProposalRequested: 1, totalConversions: 1 };
    const snapshot = createPilotMetricSnapshot({ period: { from: '2030-01-01T00:00:00Z', to: '2030-01-02T00:00:00Z' }, counts });
    expect(snapshot.rates.approval.value).toBe(.5); expect(snapshot.rates.response.value).toBe(.5);
    expect(snapshot.rates.conversion).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(JSON.stringify(snapshot)).not.toMatch(/name|phone|email|address|cnpj|message/i);
    expect(() => createPilotMetricSnapshot({ period: snapshot.period, counts: { ...counts, email: 'synthetic@example.invalid' } })).toThrow();
  });
  it('requires an ordered explicit UTC period and safe integer counts', () => {
    expect(() => createPilotMetricSnapshot({ period: { from: '2030-01-02T00:00:00Z', to: '2030-01-01T00:00:00Z' }, counts: zeroCounts })).toThrow();
    expect(() => createPilotMetricSnapshot({ period: { from: '2030-01-01T00:00:00+01:00', to: '2030-01-02T00:00:00Z' }, counts: zeroCounts })).toThrow();
    expect(() => createPilotMetricSnapshot({ period: { from: '2030-01-01T00:00:00Z', to: '2030-01-02T00:00:00Z' }, counts: { ...zeroCounts, totalAssociated: -1 } })).toThrow();
  });
  it('never emits a funnel rate above one for a partial period', () => {
    const counts = { ...zeroCounts, totalResponses: 1, totalInterested: 2, totalProposalRequested: 3, totalConversions: 4 };
    const snapshot = createPilotMetricSnapshot({ period: { from: '2030-01-01T00:00:00Z', to: '2030-01-02T00:00:00Z' }, counts });
    expect(Object.values(snapshot.rates).every(({ value }) => value === null || value <= 1)).toBe(true);
  });
});
