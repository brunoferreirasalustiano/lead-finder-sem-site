import { describe, expect, it } from 'vitest';
import {
  CampaignDomainError, assertCampaignTransition, campaignAttemptStates, campaignAttemptTransitionGraph,
  campaignFingerprint, campaignRecipientStates, campaignRecipientTransitionGraph, campaignStates,
  campaignTransitionGraph, campaignVersionStates, campaignVersionTransitionGraph, cancelCampaign,
  defineCampaignTemplate, evaluateCampaignEligibility, pauseCampaign, renderCampaignTemplate,
  resumeCampaign, type CampaignEligibilityCandidate,
} from './campaign.js';

const verifyMatrix = <T extends string>(states: readonly T[], graph: Readonly<Record<T, readonly T[]>>) => {
  expect(Object.keys(graph)).toEqual(states);
  for (const from of states) for (const to of states) {
    if (graph[from].includes(to)) expect(() => assertCampaignTransition(graph, from, to)).not.toThrow();
    else expect(() => assertCampaignTransition(graph, from, to)).toThrowError(CampaignDomainError);
  }
};
const eligible: CampaignEligibilityCandidate = {
  qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'QUALIFICADO', isBlocked: false, doNotContact: false,
  contact: { channel: 'EMAIL', isValid: true, verifiedAt: '2026-07-12T12:00:00Z' }, optOuts: [],
  isFirstContact: true, firstContactApproval: { approvedBy: 'reviewer', approvedAt: '2026-07-12T12:01:00Z' },
};

describe('campaign transitions', () => {
  it('validates every transition matrix', () => {
    verifyMatrix(campaignStates, campaignTransitionGraph); verifyMatrix(campaignVersionStates, campaignVersionTransitionGraph);
    verifyMatrix(campaignRecipientStates, campaignRecipientTransitionGraph); verifyMatrix(campaignAttemptStates, campaignAttemptTransitionGraph);
  });
  it('pauses, resumes and cancels explicitly', () => {
    expect(pauseCampaign('ATIVA')).toBe('PAUSADA'); expect(resumeCampaign('PAUSADA')).toBe('ATIVA');
    expect(cancelCampaign('RASCUNHO')).toBe('CANCELADA'); expect(() => resumeCampaign('CANCELADA')).toThrowError(CampaignDomainError);
  });
});

describe('campaign eligibility', () => {
  it('accepts a compatible qualified CRM candidate', () => expect(evaluateCampaignEligibility(eligible)).toEqual({ eligible: true }));
  it.each([
    ['qualification', { qualificationStatus: 'PENDENTE' as const }, 'QUALIFICATION_REQUIRED'],
    ['discarded', { qualificationStatus: 'DESCARTADO' as const }, 'LEAD_DISCARDED'],
    ['unverified', { contact: { ...eligible.contact, verifiedAt: null } }, 'CONTACT_NOT_VERIFIED'],
    ['invalid contact', { contact: { ...eligible.contact, isValid: false } }, 'CONTACT_NOT_VERIFIED'],
    ['blocked', { isBlocked: true }, 'LEAD_BLOCKED'], ['do not contact', { doNotContact: true }, 'DO_NOT_CONTACT'],
    ['CRM no contact', { crmStage: 'NAO_CONTATAR' as const }, 'CRM_DO_NOT_CONTACT'],
    ['channel opt-out', { optOuts: ['EMAIL'] as const }, 'CHANNEL_OPT_OUT'],
    ['global opt-out', { optOuts: ['TODOS'] as const }, 'CHANNEL_OPT_OUT'],
    ['approval missing', { firstContactApproval: null }, 'FIRST_CONTACT_APPROVAL_REQUIRED'],
    ['approval actor blank', { firstContactApproval: { approvedBy: '   ', approvedAt: '2026-07-12T12:01:00Z' } }, 'FIRST_CONTACT_APPROVAL_REQUIRED'],
    ['approval date invalid', { firstContactApproval: { approvedBy: 'reviewer', approvedAt: 'not-a-date' } }, 'FIRST_CONTACT_APPROVAL_REQUIRED'],
  ])('blocks %s independently', (_name, patch, reason) => expect(evaluateCampaignEligibility({ ...eligible, ...patch })).toEqual({ eligible: false, reason }));
  it('applies opt-out by channel and permits later contacts without first-contact approval', () => {
    expect(evaluateCampaignEligibility({ ...eligible, contact: { ...eligible.contact, channel: 'WHATSAPP' }, optOuts: ['EMAIL'] })).toEqual({ eligible: true });
    expect(evaluateCampaignEligibility({ ...eligible, isFirstContact: false, firstContactApproval: null })).toEqual({ eligible: true });
  });
});

describe('campaign templates', () => {
  const template = defineCampaignTemplate('Olá {{name}}, proposta para {{business}}.', ['name', 'business']);
  it('renders deterministically', () => {
    const values = { name: 'Ana', business: 'Oficina Azul' };
    expect(renderCampaignTemplate(template, values)).toBe('Olá Ana, proposta para Oficina Azul.');
    expect(renderCampaignTemplate(template, values)).toBe(renderCampaignTemplate(template, values));
  });
  it('rejects unknown and missing variables', () => {
    expect(() => defineCampaignTemplate('Olá {{secret}}', ['name'])).toThrowError(CampaignDomainError);
    expect(() => renderCampaignTemplate(template, { name: 'Ana' })).toThrowError(CampaignDomainError);
    expect(() => renderCampaignTemplate(template, { name: 'Ana', business: 'X', secret: 'Y' })).toThrowError(CampaignDomainError);
  });
  it.each(['__proto__', 'prototype', 'constructor'])('rejects reserved allowed variable: %s', (name) => {
    expect(() => defineCampaignTemplate(`Olá {{${name}}}`, [name])).toThrowError(CampaignDomainError);
  });
  it.each(['Olá {{name', 'Olá {name}', 'Olá {{ user.name }}', 'Olá {{__proto__}}', 'Olá {{prototype}}', 'Olá {{constructor}}', '<script>alert(1)</script>', '<a href="javascript:alert(1)">x</a>'])('rejects malformed, reserved, arbitrary or active input: %s', (content) => {
    expect(() => defineCampaignTemplate(content, ['name'])).toThrowError(CampaignDomainError);
  });
  it('rejects inherited values', () => {
    const inherited = Object.create({ name: 'Ana' }) as Record<string, string>;
    expect(() => renderCampaignTemplate(defineCampaignTemplate('Olá {{name}}', ['name']), inherited)).toThrowError(CampaignDomainError);
  });
  it.each(['<script>alert(1)</script>', '<b>texto</b>', 'javascript:alert(1)', 'texto onclick=alert(1)'])('rejects active rendered value: %s', (value) => {
    expect(() => renderCampaignTemplate(defineCampaignTemplate('{{name}}', ['name']), { name: value })).toThrowError(CampaignDomainError);
  });
  it.each([
    ['<{{tag}}>x</{{tag}}>', ['tag'], { tag: 'script' }],
    ['{{scheme}}:alert(1)', ['scheme'], { scheme: 'javascript' }],
    ['on{{event}}=alert(1)', ['event'], { event: 'click' }],
    ['{{open}}b>x</b{{close}}', ['open', 'close'], { open: '<', close: '>' }],
  ])('rejects active content assembled in the final output: %s', (content, allowedVariables, values) => {
    expect(() => renderCampaignTemplate(defineCampaignTemplate(content, allowedVariables), values)).toThrowError(CampaignDomainError);
  });
  it('continues rendering valid plain text assembled from template and values', () => {
    expect(renderCampaignTemplate(defineCampaignTemplate('{{greeting}}, {{name}}!', ['greeting', 'name']), { greeting: 'Olá', name: 'Ana' })).toBe('Olá, Ana!');
  });
});

describe('campaign fingerprint', () => {
  it('is deterministic for normalized content', () => {
    expect(campaignFingerprint([' Olá   mundo ', 'linha\r\nfinal'])).toBe(campaignFingerprint(['Olá mundo', 'linha\nfinal']));
    expect(campaignFingerprint(['a', 'b'])).not.toBe(campaignFingerprint(['b', 'a']));
  });
});
