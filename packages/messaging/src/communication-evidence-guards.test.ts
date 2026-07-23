import { describe, expect, it } from 'vitest';
import {
  communicationChannels,
  communicationNiches,
  opportunityStates,
  openingStyles,
  personalizationLevels,
  sourceTypes,
  type CommunicationChannel,
  type CommunicationVariant,
  type SourceType,
} from './communication-lab.js';
import {
  diagnosticEvidenceStates,
  evaluateGuardedCommunicationVariant,
  validateCommunicationEvidence,
} from './communication-evidence-guards.js';

const expectedSources: Readonly<Record<CommunicationChannel, ReadonlySet<SourceType>>> = {
  EMAIL: new Set(['OFFICIAL_WEBSITE', 'PUBLIC_BUSINESS_DIRECTORY', 'DIRECTLY_PROVIDED']),
  CONTACT_FORM: new Set(['OFFICIAL_CONTACT_FORM']),
  BUSINESS_DM: new Set(['OFFICIAL_BUSINESS_PROFILE']),
  WHATSAPP_OPT_IN: new Set(['DIRECTLY_PROVIDED']),
};

const base = (overrides: Partial<CommunicationVariant>): CommunicationVariant => ({
  id: 'guard-case',
  niche: 'AUTOMOTIVE',
  opportunity: 'BROKEN_SITE',
  channel: 'EMAIL',
  opening: 'PERMISSION_FIRST',
  tone: 'CONSULTATIVE',
  cta: 'ASK_PERMISSION',
  personalization: 'SEGMENT',
  optOut: 'EXPLICIT',
  linkPolicy: 'NONE',
  authorization: 'NOT_REQUIRED',
  sourceType: 'OFFICIAL_WEBSITE',
  ...overrides,
});

const channelSourceCases = communicationNiches.flatMap((niche) =>
  opportunityStates.flatMap((opportunity) =>
    communicationChannels.flatMap((channel) =>
      sourceTypes.map((sourceType) => ({ niche, opportunity, channel, sourceType })),
    ),
  ),
);

const diagnosticCases = communicationNiches.flatMap((niche) =>
  opportunityStates.flatMap((opportunity) =>
    openingStyles.flatMap((opening) =>
      personalizationLevels.flatMap((personalization) =>
        diagnosticEvidenceStates.map((diagnosticEvidence) => ({
          niche,
          opportunity,
          opening,
          personalization,
          diagnosticEvidence,
        })),
      ),
    ),
  ),
);

describe('channel and source coherence', () => {
  it('covers 1,260 niche × opportunity × channel × source interactions', () => {
    expect(channelSourceCases).toHaveLength(1_260);
  });

  it.each(channelSourceCases)(
    '$niche / $opportunity / $channel / $sourceType enforces source compatibility',
    ({ niche, opportunity, channel, sourceType }) => {
      const variant = base({
        niche,
        opportunity,
        channel,
        sourceType,
        authorization: channel === 'WHATSAPP_OPT_IN' ? 'DIRECT_OPT_IN' : 'NOT_REQUIRED',
      });
      const result = validateCommunicationEvidence(variant, { diagnosticEvidence: 'NOT_APPLICABLE' });
      const expected = expectedSources[channel].has(sourceType);

      expect(result.codes.includes('CHANNEL_SOURCE_MISMATCH')).toBe(!expected);
    },
  );
});

describe('diagnostic evidence coherence', () => {
  it('covers 1,620 niche × opportunity × opening × personalization × evidence interactions', () => {
    expect(diagnosticCases).toHaveLength(1_620);
  });

  it.each(diagnosticCases)(
    '$niche / $opportunity / $opening / $personalization / $diagnosticEvidence gates diagnostic claims',
    ({ niche, opportunity, opening, personalization, diagnosticEvidence }) => {
      const variant = base({ niche, opportunity, opening, personalization });
      const result = evaluateGuardedCommunicationVariant(variant, { diagnosticEvidence });
      const requiresEvidence = opening === 'DIAGNOSIS_FIRST' || personalization === 'DIAGNOSIS';

      expect(result.codes.includes('DIAGNOSTIC_EVIDENCE_REQUIRED')).toBe(
        requiresEvidence && diagnosticEvidence !== 'VERIFIED',
      );
      expect(result.eligible).toBe(!requiresEvidence || diagnosticEvidence === 'VERIFIED');
      if (!result.eligible) expect(result.score).toBe(0);
    },
  );

  it('warns when verified evidence is available but the selected message does not use it', () => {
    const result = evaluateGuardedCommunicationVariant(base({}), { diagnosticEvidence: 'VERIFIED' });
    expect(result.eligible).toBe(true);
    expect(result.warnings).toContain('DIAGNOSTIC_EVIDENCE_AVAILABLE_BUT_NOT_USED');
  });

  it('does not expose raw evidence or contact data in guard results', () => {
    const result = evaluateGuardedCommunicationVariant(
      base({ opening: 'DIAGNOSIS_FIRST', personalization: 'DIAGNOSIS' }),
      { diagnosticEvidence: 'VERIFIED' },
    );
    expect(JSON.stringify(result)).not.toMatch(/@|\+55|evidenceText|rawPayload/i);
  });
});
