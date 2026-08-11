import { z } from 'zod';

export const qualificationStatuses = [
  'PENDENTE',
  'VALIDANDO',
  'SITE_ENCONTRADO',
  'SEM_SITE_CONFIRMADO',
  'INCONCLUSIVO',
  'DESCARTADO',
] as const;
export type QualificationStatus = (typeof qualificationStatuses)[number];
export const qualificationStatusSchema = z.enum(qualificationStatuses);
export const contactTypes = ['TELEFONE', 'EMAIL'] as const;
export type ContactType = (typeof contactTypes)[number];

const compact = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
export const normalizeBusinessName = (value: string) =>
  compact(value)
    .replace(/\b(ltda|me|eireli|sa)\b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
export const normalizeAddress = compact;
export const normalizeEmail = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  return z.string().email().safeParse(normalized).success ? normalized : null;
};
export const normalizeBrazilianPhone = (value: string): string | null => {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  if (!/^[1-9]{2}(?:[2-5]\d{7}|9\d{8})$/.test(digits)) return null;
  return `+55${digits}`;
};

const transitions: Record<QualificationStatus, readonly QualificationStatus[]> = {
  PENDENTE: ['VALIDANDO', 'DESCARTADO'],
  VALIDANDO: ['SITE_ENCONTRADO', 'SEM_SITE_CONFIRMADO', 'INCONCLUSIVO', 'DESCARTADO'],
  SITE_ENCONTRADO: ['VALIDANDO', 'DESCARTADO'],
  SEM_SITE_CONFIRMADO: ['VALIDANDO', 'DESCARTADO'],
  INCONCLUSIVO: ['VALIDANDO', 'DESCARTADO'],
  DESCARTADO: [],
};
export const canTransitionQualification = (from: QualificationStatus, to: QualificationStatus) =>
  transitions[from].includes(to);

export interface OutreachCandidate {
  qualificationStatus: QualificationStatus;
  websiteStatus?: 'UNKNOWN' | 'OFFICIAL_SITE_FOUND' | 'NO_OFFICIAL_SITE_CONFIRMED';
  isBlocked: boolean;
  doNotContact: boolean;
  contacts: Array<{ isValid: boolean; verifiedAt: Date | string | null }>;
}
export const isEligibleForOutreach = (lead: OutreachCandidate) =>
  lead.qualificationStatus === 'SEM_SITE_CONFIRMADO' &&
  lead.websiteStatus === 'NO_OFFICIAL_SITE_CONFIRMED' &&
  !lead.isBlocked &&
  !lead.doNotContact &&
  lead.contacts.some((contact) => contact.isValid && contact.verifiedAt !== null);

const auditSchema = z.object({
  actor: z.string().trim().min(1).max(100),
  source: z.string().trim().min(1).max(100),
  reason: z.string().trim().max(1000).optional(),
});
export const evidenceInputSchema = auditSchema
  .extend({
    source: z.string().trim().min(1).max(100),
    reference: z.string().trim().max(2048).optional(),
    result: z.string().trim().min(1).max(200),
    confidence: z.number().min(0).max(1),
    observedAt: z.coerce.date(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const contactInputSchema = auditSchema
  .extend({
    type: z.enum(contactTypes),
    value: z.string().trim().min(3).max(320),
    confidence: z.number().min(0).max(1),
    verifiedAt: z.coerce.date().nullable().optional(),
    isValid: z.boolean().default(false),
    possibleWhatsapp: z.boolean().default(false),
  })
  .strict();
export const qualificationUpdateSchema = auditSchema
  .extend({
    status: qualificationStatusSchema,
    isBlocked: z.boolean().optional(),
    doNotContact: z.boolean().optional(),
  })
  .strict();

export const attemptsToClearNonContact = (
  current: { isBlocked: boolean; doNotContact: boolean },
  requested: { isBlocked?: boolean | undefined; doNotContact?: boolean | undefined },
) => (current.isBlocked && requested.isBlocked === false)
  || (current.doNotContact && requested.doNotContact === false);
