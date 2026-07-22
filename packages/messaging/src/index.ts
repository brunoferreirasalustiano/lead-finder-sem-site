import { createHash } from 'node:crypto';
import { z } from 'zod';

export const messagingChannelSchema = z.enum(['WHATSAPP', 'EMAIL']);
export const whatsappAuthorizationOriginSchema = z.enum([
  'DIRECT_OPT_IN',
  'FORM_OPT_IN',
  'SIGNED_RECORD',
]);
export const whatsappAuthorizationSchema = z.object({
  channel: z.literal('WHATSAPP'),
  purpose: z.string().trim().min(1).max(100),
  origin: whatsappAuthorizationOriginSchema,
  evidenceId: z.string().uuid(),
  recordedAt: z.coerce.date(),
});
export const emailBusinessEvidenceOriginSchema = z.enum([
  'PUBLIC_BUSINESS_SOURCE',
  'DIRECTLY_PROVIDED',
  'SIGNED_RECORD',
]);
export const emailBusinessEvidenceSchema = z.object({
  channel: z.literal('EMAIL'),
  ownership: z.enum(['BUSINESS', 'PERSONAL', 'UNKNOWN']),
  origin: emailBusinessEvidenceOriginSchema,
  evidenceId: z.string().uuid(),
  evidenceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  humanDecision: z.enum(['APPROVED', 'REJECTED']),
  reviewedBy: z.string().trim().min(1).max(100),
  version: z.number().int().positive(),
  recordedAt: z.coerce.date(),
});
export const templateSchema = z.object({
  id: z.string().trim().min(1).max(100),
  version: z.string().regex(/^v[1-9][0-9]*$/),
  channel: messagingChannelSchema,
  approved: z.literal(true),
  subject: z.string().max(200).optional(),
  body: z.string().trim().min(1).max(2000),
});
export const eligibilityResultSchema = z.object({
  eligible: z.boolean(),
  codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(20),
});
export const channelDecisionSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ALLOWED'),
    channel: messagingChannelSchema,
    contactId: z.string().uuid(),
  }),
  z.object({
    state: z.literal('BLOCKED'),
    channel: z.null(),
    contactId: z.null(),
    codes: z.array(z.string()),
  }),
]);
export const preparedMessageSchema = z.object({
  channel: messagingChannelSchema,
  templateId: z.string(),
  templateVersion: z.string(),
  subject: z.string().optional(),
  body: z.string(),
  fingerprint: z.string().length(64),
});
export const manualActionSchema = z.enum([
  'PREPARED',
  'OPENED',
  'CONTACT_CONFIRMED',
  'RESPONSE_RECORDED',
]);
export const manualResultSchema = z.enum([
  'SENT_CONFIRMED',
  'NOT_SENT',
  'INVALID_CONTACT',
  'CHANNEL_UNAVAILABLE',
  'POSITIVE_REPLY',
  'NEGATIVE_REPLY',
  'OPT_OUT',
  'OPERATIONAL_ERROR',
]);
export type MessagingChannel = z.infer<typeof messagingChannelSchema>;
export type MessageTemplate = z.infer<typeof templateSchema>;
export type PreparedMessage = z.infer<typeof preparedMessageSchema>;
export interface FakeMessagingProvider {
  prepare(template: MessageTemplate, variables: Readonly<Record<string, string>>): PreparedMessage;
}
const interpolate = (text: string, variables: Readonly<Record<string, string>>) =>
  text.replace(/\[([A-Z_]+)\]/g, (_, key: string) => variables[key] ?? `[${key}]`);
export class DeterministicFakeMessagingProvider implements FakeMessagingProvider {
  prepare(input: MessageTemplate, variables: Readonly<Record<string, string>>): PreparedMessage {
    const template = templateSchema.parse(input);
    const body = interpolate(template.body, variables);
    const subject = template.subject ? interpolate(template.subject, variables) : undefined;
    return preparedMessageSchema.parse({
      channel: template.channel,
      templateId: template.id,
      templateVersion: template.version,
      subject,
      body,
      fingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            channel: template.channel,
            id: template.id,
            version: template.version,
            subject,
            body,
          }),
        )
        .digest('hex'),
    });
  }
}
export const approvedTemplates = {
  whatsappV1: templateSchema.parse({
    id: 'pilot-whatsapp-first-contact',
    version: 'v1',
    channel: 'WHATSAPP',
    approved: true,
    body: 'Olá! Aqui é o Bruno F. Salustiano, da Lead Finder Brasil. Você autorizou nosso contato por WhatsApp sobre soluções digitais para a [EMPRESA]. Preparei uma ideia relacionada ao segmento de vocês. Posso enviar a demonstração para avaliação, sem compromisso? Caso não queira continuar, é só me avisar que encerro o contato e registro o bloqueio.',
  }),
  emailV1: templateSchema.parse({
    id: 'pilot-email-first-contact',
    version: 'v1',
    channel: 'EMAIL',
    approved: true,
    subject: 'Ideia de presença digital para [EMPRESA]',
    body: 'Olá, tudo bem? Meu nome é Bruno F. Salustiano, fundador da Lead Finder Brasil. Encontrei o contato comercial da [EMPRESA] em [FONTE] e estou entrando em contato individualmente porque trabalho com criação de páginas e soluções digitais para negócios locais. Preparei uma ideia de demonstração relacionada ao segmento de vocês. Posso enviar para uma avaliação, sem compromisso? Caso prefira não receber novos contatos, basta responder a este e-mail informando isso e farei o bloqueio imediato.',
  }),
} as const;
