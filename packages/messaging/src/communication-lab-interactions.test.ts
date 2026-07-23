import { describe, expect, it } from 'vitest';
import {
  communicationChannels,
  communicationNiches,
  evaluateCommunicationVariant,
  opportunityStates,
  type CommunicationVariant,
} from './communication-lab.js';

const base = (overrides: Partial<CommunicationVariant>): CommunicationVariant => ({
  id: 'interaction',
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

const interactionCases = communicationNiches.flatMap((niche) =>
  opportunityStates.flatMap((opportunity) =>
    communicationChannels.map((channel) => ({ niche, opportunity, channel })),
  ),
);

describe('cross-dimension communication coverage', () => {
  it('covers all 180 niche × opportunity × channel interactions', () => {
    expect(interactionCases).toHaveLength(180);
  });

  it.each(interactionCases)('$niche / $opportunity / $channel stays deterministic and sanitized', ({ niche, opportunity, channel }) => {
    const authorization = channel === 'WHATSAPP_OPT_IN' ? 'DIRECT_OPT_IN' : 'NOT_REQUIRED';
    const sourceType = channel === 'CONTACT_FORM'
      ? 'OFFICIAL_CONTACT_FORM'
      : channel === 'BUSINESS_DM'
        ? 'OFFICIAL_BUSINESS_PROFILE'
        : channel === 'WHATSAPP_OPT_IN'
          ? 'DIRECTLY_PROVIDED'
          : 'OFFICIAL_WEBSITE';
    const variant = base({ niche, opportunity, channel, authorization, sourceType });
    const first = evaluateCommunicationVariant(variant);
    const second = evaluateCommunicationVariant(variant);

    expect(first).toEqual(second);
    expect(first.eligible).toBe(true);
    expect(first.rendered.body).toContain('[EMPRESA]');
    expect(first.rendered.body).not.toMatch(/\b(?:sent|delivered|disparo em massa)\b/i);
    expect(first.rendered.body).not.toMatch(/\b(?:garantimos|resultado garantido|dobrar vendas)\b/i);
  });

  it('exposes the current limitation that niche alone does not change heuristic score', () => {
    const scores = communicationNiches.map((niche) => evaluateCommunicationVariant(base({ niche })).score);
    expect(new Set(scores).size).toBe(1);
  });
});
