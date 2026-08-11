import { z } from 'zod';
export {
  apiAuthPermissions, assertApiKillSwitchReleased, hmlOperatorAuthPermissions, hmlSmokeAuthPermissions, parseApiConfig, parseWorkerConfig, type ApiAuthPermission,
} from './config.js';
export * from './qualification.js';
export * from './crm.js';
export * from './campaign.js';
export * from './campaign-execution.js';
export * from './shadow-mode.js';
export * from './pilot.js';
export * from './pilot-real-preflight.js';
export * from './operator-test-recipient-binding.js';
export * from './automated-compliance.js';

export const leadStatuses = [
  'SEM_SITE_CADASTRADO',
  'PROVAVELMENTE_SEM_SITE',
  'POSSUI_SITE',
  'PENDENTE_VALIDACAO',
  'INVALIDO',
] as const;
export type LeadStatus = (typeof leadStatuses)[number];
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

/**
 * Durable identity for an externally retriable collection request.
 *
 * The slot and policy are deliberately part of the identity so a retry of
 * one scheduled batch cannot create a second logical job, while the next
 * scheduled slot remains an independent collection.
 */
export const collectionRequestIdentitySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}\|(09|13|16)\|[a-z0-9]+(?:-[a-z0-9]+)*\|daily6-v1$/u)
  .refine((identity) => {
    const date = identity.slice(0, 10);
    const parsed = new Date(date + 'T00:00:00.000Z');
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
  }, 'collection identity date must be a real calendar date');
export type CollectionRequestIdentity = z.infer<typeof collectionRequestIdentitySchema>;

export const collectionCityId = (city: string, state: string) =>
  `${city.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/[^a-z0-9]+/gu, '-')}-${state.trim().toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/gu, '')}`
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');

export const parseCollectionRequestIdentity = (identity: string) => {
  const parsed = collectionRequestIdentitySchema.safeParse(identity);
  if (!parsed.success) return null;
  const [date, slot, cityId, policyVersion] = parsed.data.split('|') as [string, '09' | '13' | '16', string, string];
  return { date, slot, cityId, policyVersion };
};

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

export interface NormalizedLead {
  osmType: 'node' | 'way' | 'relation';
  osmId: string;
  name: string | null;
  category: Category;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  /** OSM alone cannot prove ownership or absence of a website. */
  websiteStatus?: 'UNKNOWN' | 'OFFICIAL_SITE_FOUND' | 'NO_OFFICIAL_SITE_CONFIRMED';
  instagram: string | null;
  facebook: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  isClosed: boolean;
}
