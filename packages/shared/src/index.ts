import { z } from 'zod';
export { parseApiConfig, parseWorkerConfig } from './config.js';

export const leadStatuses = [
  'SEM_SITE_CADASTRADO',
  'PROVAVELMENTE_SEM_SITE',
  'POSSUI_SITE',
  'PENDENTE_VALIDACAO',
  'INVALIDO',
] as const;
export type LeadStatus = (typeof leadStatuses)[number];

export const validationStatuses = [
  'PENDENTE',
  'VALIDANDO',
  'SITE_ENCONTRADO',
  'SEM_SITE_CONFIRMADO',
  'INCONCLUSIVO',
  'DESCARTADO',
] as const;
export type ValidationStatus = (typeof validationStatuses)[number];

export const contactTypes = ['TELEFONE', 'WHATSAPP', 'EMAIL'] as const;
export type ContactType = (typeof contactTypes)[number];

export const categories = [
  'oficinas',
  'autoeletricas',
  'saloes-de-beleza',
  'barbearias',
  'clinicas',
  'consultorios',
  'restaurantes',
  'lanchonetes',
  'empresas-de-seguranca',
  'prestadores-de-servicos',
] as const;
export const categorySchema = z.enum(categories);
export type Category = z.infer<typeof categorySchema>;

const actorSchema = z.string().trim().min(1).max(120);
const originSchema = z.string().trim().min(1).max(120);
const reasonSchema = z.string().trim().min(3).max(500);
const idempotencyKeySchema = z.string().trim().min(8).max(200);

export const collectSchema = z
  .object({
    city: z.string().trim().min(2).max(100).default('Campinas'),
    state: z.string().trim().min(2).max(50).default('SP'),
    country: z.string().trim().min(2).max(80).default('Brasil'),
    category: categorySchema,
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();
export type CollectInput = z.infer<typeof collectSchema>;

export const listLeadsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(leadStatuses).optional(),
    category: categorySchema.optional(),
    city: z.string().trim().min(2).max(100).optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
  })
  .strict();

export const validationTransitionSchema = z
  .object({
    status: z.enum(validationStatuses),
    actor: actorSchema,
    origin: originSchema,
    reason: reasonSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type ValidationTransitionInput = z.infer<typeof validationTransitionSchema>;

export const evidenceSchema = z
  .object({
    source: z.string().trim().min(1).max(200),
    evidenceType: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(2_000),
    metadata: z.record(z.string(), z.unknown()).default({}),
    actor: actorSchema,
    origin: originSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type EvidenceInput = z.infer<typeof evidenceSchema>;

export const contactSchema = z
  .object({
    type: z.enum(contactTypes),
    value: z.string().trim().min(3).max(320),
    source: z.string().trim().min(1).max(200),
    confidence: z.coerce.number().int().min(0).max(100),
    actor: actorSchema,
    origin: originSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type ContactInput = z.infer<typeof contactSchema>;

export const contactActionSchema = z
  .object({
    actor: actorSchema,
    origin: originSchema,
    reason: reasonSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type ContactActionInput = z.infer<typeof contactActionSchema>;

export const doNotContactSchema = z
  .object({
    blocked: z.boolean(),
    actor: actorSchema,
    origin: originSchema,
    reason: reasonSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type DoNotContactInput = z.infer<typeof doNotContactSchema>;

export interface NormalizedLead {
  osmType: 'node' | 'way' | 'relation';
  osmId: string;
  name: string | null;
  category: Category;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  isClosed: boolean;
}
