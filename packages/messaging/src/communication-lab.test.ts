import { describe, expect, it } from 'vitest';
import {
  communicationSolutions,
  evaluateCommunicationVariant,
  generateCoreCommunicationCases,
  generateExtendedCommunicationCases,
  renderCommunicationVariant,
  summarizeCommunicationExperiment,
  type AuthorizationState,
  type CommunicationVariant,
  type SourceType,
} from './communication-lab.js';

const coreCases = generateCoreCommunicationCases();
const extendedCases = generateExtendedCommunicationCases();
const realEmailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const realPhonePattern = /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}\b/;

const baseVariant = (overrides: Partial<CommunicationVariant> = {}): CommunicationVariant => ({
  id: 'test-variant',
  niche: 'AUTOMOTIVE',
  opportunity: 'BROKEN_SITE',
  channel: 'EMAIL',
  opening: 'DIAGNOSIS_FIRST',
  tone: 'CONSULTATIVE',
  cta: 'ASK_PERMISSION',
  personalization: 'DIAGNOSIS',
  optOut: 'EXPLICIT',
  linkPolicy: 'NONE',
  authorization: 'NOT_REQUIRED',
  sourceType: 'OFFICIAL_WEBSITE',
  ...overrides,
});

describe('communication experiment catalog', () => {
  it('documents ten distinct communication solutions', () => {
    expect(communicationSolutions).toHaveLength(10);
    expect(new Set(communicationSolutions.map((solution) => solution.id)).size).toBe(10);
  });

  it('separates inbound acquisition from outbound channels', () => {
    expect(communicationSolutions.filter((solution) => solution.channel === 'INBOUND')).toHaveLength(3);
    expect(communicationSolutions.find((solution) => solution.id === 'WHATSAPP_AFTER_OPT_IN'))
      .toMatchObject({ requiresOptIn: true, channel: 'WHATSAPP_OPT_IN' });
  });
});

describe('1,080 named core communication cases', () => {
  it('builds exactly 1,080 deterministic cases', () => {
    expect(coreCases).toHaveLength(1_080);
    expect(new Set(coreCases.map((variant) => variant.id)).size).toBe(1_080);
  });

  it.each(coreCases)('$id remains eligible, transparent and free of real PII', (variant: CommunicationVariant) => {
    const evaluation = evaluateCommunicationVariant(variant);
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.codes).toEqual([]);
    expect(evaluation.score).toBeGreaterThanOrEqual(35);
    expect(evaluation.score).toBeLessThanOrEqual(100);
    expect(evaluation.rendered.body).toContain('[EMPRESA]');
    expect(evaluation.rendered.body).not.toMatch(realEmailPattern);
    expect(evaluation.rendered.body).not.toMatch(realPhonePattern);
    expect(evaluation.rendered.body).not.toMatch(/garantimos|resultado garantido|dobrar vendas/i);
    expect(evaluation.rendered.body).not.toMatch(/\b(?:sent|delivered)\b|disparo em massa/i);
  });
});

describe('extended communication matrix', () => {
  it('evaluates 14,580 diverse synthetic scenarios', () => {
    expect(extendedCases).toHaveLength(14_580);
    expect(new Set(extendedCases.map((variant) => variant.id)).size).toBe(14_580);
  });

  it('blocks every variant without opt-out', () => {
    const missingOptOut = extendedCases
      .filter((variant) => variant.optOut === 'MISSING')
      .map(evaluateCommunicationVariant);
    expect(missingOptOut.length).toBeGreaterThan(4_000);
    expect(missingOptOut.every((evaluation) => evaluation.codes.includes('OPT_OUT_REQUIRED'))).toBe(true);
  });

  it('blocks every third-party link in the first-contact matrix', () => {
    const thirdParty = extendedCases
      .filter((variant) => variant.linkPolicy === 'THIRD_PARTY')
      .map(evaluateCommunicationVariant);
    expect(thirdParty.length).toBeGreaterThan(4_000);
    expect(thirdParty.every((evaluation) => evaluation.codes.includes('THIRD_PARTY_LINK_BLOCKED'))).toBe(true);
  });

  it('produces stable aggregate rankings without claiming real conversion', () => {
    const summary = summarizeCommunicationExperiment(extendedCases.map(evaluateCommunicationVariant));
    expect(summary.total).toBe(14_580);
    expect(summary.eligible).toBeGreaterThan(8_000);
    expect(summary.blocked).toBeGreaterThan(4_000);
    expect(summary.averageEligibleScore).toBeGreaterThan(50);
    expect(summary.averageEligibleScore).toBeLessThan(80);
    expect(summary.byChannel[0]?.key).toBe('WHATSAPP_OPT_IN');
    expect(summary.byOpening[0]?.key).toBe('DIAGNOSIS_FIRST');
    expect(summary.byTone[0]?.key).toBe('CONSULTATIVE');
    expect(summary.byCta[0]?.key).toBe('ASK_PERMISSION');
    expect(summary.topVariants).toHaveLength(25);
  });
});

describe('channel and source guardrails', () => {
  it('does not treat a public business number as WhatsApp opt-in', () => {
    const evaluation = evaluateCommunicationVariant(baseVariant({
      channel: 'WHATSAPP_OPT_IN',
      authorization: 'PUBLIC_NUMBER',
      sourceType: 'OFFICIAL_BUSINESS_PROFILE',
    }));
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.codes).toContain('WHATSAPP_OPT_IN_REQUIRED');
  });

  it.each(['DIRECT_OPT_IN', 'FORM_OPT_IN', 'SIGNED_RECORD'] as const)(
    'allows WhatsApp preparation after %s',
    (authorization: Extract<AuthorizationState, 'DIRECT_OPT_IN' | 'FORM_OPT_IN' | 'SIGNED_RECORD'>) => {
      const evaluation = evaluateCommunicationVariant(baseVariant({
        channel: 'WHATSAPP_OPT_IN',
        authorization,
        sourceType: 'DIRECTLY_PROVIDED',
      }));
      expect(evaluation.eligible).toBe(true);
      expect(evaluation.rendered.body).toContain('Obrigado por autorizar');
    },
  );

  it.each(['PURCHASED_LIST', 'LEAKED_DATA'] as const)(
    'rejects source %s',
    (sourceType: Extract<SourceType, 'PURCHASED_LIST' | 'LEAKED_DATA'>) => {
      const evaluation = evaluateCommunicationVariant(baseVariant({ sourceType }));
      expect(evaluation.eligible).toBe(false);
      expect(evaluation.codes).toContain('SOURCE_REJECTED');
    },
  );

  it('keeps directory evidence under review without automatically blocking e-mail', () => {
    const evaluation = evaluateCommunicationVariant(baseVariant({
      sourceType: 'PUBLIC_BUSINESS_DIRECTORY',
    }));
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.warnings).toContain('DIRECTORY_SOURCE_REQUIRES_REVIEW');
  });

  it('blocks missing opt-out even when all other fields are strong', () => {
    const evaluation = evaluateCommunicationVariant(baseVariant({ optOut: 'MISSING' }));
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.codes).toContain('OPT_OUT_REQUIRED');
  });

  it('blocks third-party links and permits a single own-domain placeholder', () => {
    expect(evaluateCommunicationVariant(baseVariant({ linkPolicy: 'THIRD_PARTY' })).codes)
      .toContain('THIRD_PARTY_LINK_BLOCKED');
    const ownDomain = evaluateCommunicationVariant(baseVariant({
      opening: 'CREDIBILITY_FIRST',
      linkPolicy: 'OWN_DOMAIN',
    }));
    expect(ownDomain.eligible).toBe(true);
    expect(ownDomain.rendered.body).toContain('[LINK_INSTITUCIONAL]');
  });
});

describe('message construction and ranking behavior', () => {
  it('is deterministic for the same variant', () => {
    const variant = baseVariant();
    expect(renderCommunicationVariant(variant)).toEqual(renderCommunicationVariant(variant));
    expect(evaluateCommunicationVariant(variant)).toEqual(evaluateCommunicationVariant(variant));
  });

  it('rewards diagnosis-first for a verified broken-site opportunity', () => {
    const diagnosis = evaluateCommunicationVariant(baseVariant({ opening: 'DIAGNOSIS_FIRST' }));
    const benefit = evaluateCommunicationVariant(baseVariant({ opening: 'BENEFIT_FIRST' }));
    expect(diagnosis.score).toBeGreaterThan(benefit.score);
  });

  it('rewards diagnosis-level personalization over generic personalization', () => {
    const diagnosis = evaluateCommunicationVariant(baseVariant({ personalization: 'DIAGNOSIS' }));
    const basic = evaluateCommunicationVariant(baseVariant({ personalization: 'BASIC' }));
    expect(diagnosis.score).toBeGreaterThan(basic.score);
  });

  it('prefers an explicit opt-out over a short opt-out without blocking either', () => {
    const explicit = evaluateCommunicationVariant(baseVariant({ optOut: 'EXPLICIT' }));
    const short = evaluateCommunicationVariant(baseVariant({ optOut: 'SHORT' }));
    expect(explicit.eligible).toBe(true);
    expect(short.eligible).toBe(true);
    expect(explicit.score).toBeGreaterThan(short.score);
  });

  it('renders channel-appropriate subject behavior', () => {
    expect(renderCommunicationVariant(baseVariant({ channel: 'EMAIL' })).subject).toBeDefined();
    expect(renderCommunicationVariant(baseVariant({ channel: 'CONTACT_FORM' })).subject).toBeUndefined();
    expect(renderCommunicationVariant(baseVariant({ channel: 'BUSINESS_DM' })).subject).toBeUndefined();
  });

  it('keeps all rendered core messages inside their channel limits', () => {
    const evaluations = coreCases.map(evaluateCommunicationVariant);
    expect(evaluations.every((evaluation) => !evaluation.codes.includes('MESSAGE_TOO_LONG'))).toBe(true);
  });
});
