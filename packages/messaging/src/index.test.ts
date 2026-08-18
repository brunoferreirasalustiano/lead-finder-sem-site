import { describe, expect, it } from 'vitest';
import {
  approvedTemplates,
  currentPilotEmailTemplate,
  DeterministicFakeMessagingProvider,
  emailBusinessEvidenceSchema,
  LEAD_FINDER_DEMOS_URL,
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

  it('preserves the historical email v1 content for fingerprint replay', () => {
    expect(approvedTemplates.emailV1.version).toBe('v1');
    expect(approvedTemplates.emailV1.subject).toBe('Ideia de presença digital para [EMPRESA]');
    expect(approvedTemplates.emailV1.body).not.toContain(LEAD_FINDER_DEMOS_URL);
  });

  it('prepares the current manual email v2 with the approved commercial copy', () => {
    const prepared = new DeterministicFakeMessagingProvider().prepare(
      currentPilotEmailTemplate,
      {
        EMPRESA: 'Studio Bela',
        FONTE: 'perfil comercial público',
      },
    );

    expect(prepared.templateId).toBe('pilot-email-first-contact');
    expect(prepared.templateVersion).toBe('v2');
    expect(prepared.subject).toBe('Posso preparar uma ideia de site para a Studio Bela?');
    expect(prepared.body).toContain('Encontrei a Studio Bela durante uma pesquisa de negócios da região');
    expect(prepared.body).toContain('ideia de site demonstrativo, sem compromisso');
    expect(prepared.body).toContain('a partir de R$ 650');
    expect(prepared.body).toContain('pagamento em até 10x no cartão');
    expect(prepared.body).toContain(LEAD_FINDER_DEMOS_URL);
    expect(prepared.body).toContain('WhatsApp Lead Finder Brasil: (19) 97151-9337');
    expect(prepared.body).toContain('basta responder a este e-mail informando que não tem interesse');
    expect(`${prepared.subject}\n${prepared.body}`).not.toMatch(/\[[A-Z_]+\]/);
    expect(prepared.body).not.toContain('[FONTE]');
    expect(prepared.body).not.toMatch(/utm_|tracking|pixel invisível/i);
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
