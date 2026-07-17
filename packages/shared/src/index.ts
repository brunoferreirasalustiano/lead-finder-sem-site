import { z } from 'zod';
export {
  apiAuthPermissions, parseApiConfig, parseWorkerConfig, type ApiAuthPermission,
} from './config.js';
export * from './qualification.js';
export * from './crm.js';
export * from './campaign.js';
export * from './campaign-execution.js';
export * from './shadow-mode.js';
export * from './pilot.js';
export * from './pilot-real-preflight.js';

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
  instagram: string | null;
  facebook: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  isClosed: boolean;
}
