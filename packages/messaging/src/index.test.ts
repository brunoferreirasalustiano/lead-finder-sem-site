import { describe, expect, it } from 'vitest';
import {
  approvedTemplates,
  DeterministicFakeMessagingProvider,
  emailBusinessEvidenceSchema,
  whatsappAuthorizationSchema,
} from './index.js';
describe('fake messaging provider', () => {
  it('prepares deterministically without claiming delivery', () => {
    const p = new DeterministicFakeMessagingProvider();
    const a = p.prepare(approvedTemplates.emailV1, {
      EMPRESA: 'Empresa',
      FONTE: 'site empresarial',
    });
    expect(
      p.prepare(approvedTemplates.emailV1, { EMPRESA: 'Empresa', FONTE: 'site empresarial' }),
    ).toEqual(a);
    expect(JSON.stringify(a)).not.toMatch(/sent|delivered/i);
  });

  it('keeps the operator email test fixed and unrelated to lead content', () => {
    const prepared = new DeterministicFakeMessagingProvider().prepare(
      approvedTemplates.operatorEmailTestV1,
      {},
    );
    expect(prepared.subject).toBe('Teste interno de e-mail — Lead Finder Brasil');
    expect(prepared.body).toContain('Nenhum lead real está envolvido');
    expect(prepared.body).not.toContain('[EMPRESA]');
    expect(prepared.body).not.toContain('[FONTE]');
  });
});

describe('channel-specific authorization contracts', () => {
  it('rejects a public business source as WhatsApp authorization', () => {
    expect(
      whatsappAuthorizationSchema.safeParse({
        channel: 'WHATSAPP',
        purpose: 'B2B_PROSPECTION',
        origin: 'PUBLIC_BUSINESS_SOURCE',
        evidenceId: '123e4567-e89b-42d3-a456-426614174000',
        recordedAt: new Date(),
      }).success,
    ).toBe(false);
  });

  it('keeps email business evidence distinct from opt-in', () => {
    expect(
      emailBusinessEvidenceSchema.safeParse({
        channel: 'EMAIL',
        ownership: 'BUSINESS',
        origin: 'PUBLIC_BUSINESS_SOURCE',
        evidenceId: '123e4567-e89b-42d3-a456-426614174000',
        evidenceFingerprint: 'a'.repeat(64),
        humanDecision: 'APPROVED',
        reviewedBy: 'reviewer-1',
        version: 1,
        recordedAt: new Date(),
      }).success,
    ).toBe(true);
  });
});
