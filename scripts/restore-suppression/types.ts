import { z } from 'zod';

export const channels = ['EMAIL', 'WHATSAPP'] as const;
export const suppressionTypes = ['IS_BLOCKED', 'DO_NOT_CONTACT', 'CRM_NAO_CONTATAR', 'OPT_OUT_GLOBAL', 'OPT_OUT_CHANNEL'] as const;
const isoTimestamp = z.string().datetime({ offset: true });
const identity = z.object({ osmType: z.enum(['node', 'way', 'relation']), osmId: z.string().min(1).max(100) }).strict();
export const suppressionEntrySchema = z.object({
  leadId: z.string().uuid().optional(), stableIdentity: identity.optional(),
  channel: z.enum(channels).optional(), suppressionType: z.enum(suppressionTypes),
  monotonicState: z.literal('ENFORCED'), occurredAt: isoTimestamp,
  reasonCode: z.string().regex(/^[A-Z0-9_]{1,80}$/u),
  operationalSource: z.string().regex(/^[A-Z0-9_.:-]{1,100}$/u),
}).strict().superRefine((entry, context) => {
  if (!entry.leadId && !entry.stableIdentity) context.addIssue({ code: 'custom', message: 'TARGET_IDENTITY_REQUIRED' });
  if ((entry.suppressionType === 'OPT_OUT_CHANNEL') !== Boolean(entry.channel)) context.addIssue({ code: 'custom', message: 'CHANNEL_SCOPE_INVALID' });
});
export const manifestContentSchema = z.object({
  schemaVersion: z.literal('1.0'), runId: z.string().uuid(), logicalOrigin: z.enum(['DATABASE_PRE_RESTORE', 'EMPTY_DATABASE_BOOTSTRAP']),
  cutoffAt: isoTimestamp, entries: z.array(suppressionEntrySchema).max(100_000),
  counts: z.object({ total: z.number().int().nonnegative().max(100_000), byType: z.object({ IS_BLOCKED:z.number().int().nonnegative(), DO_NOT_CONTACT:z.number().int().nonnegative(), CRM_NAO_CONTATAR:z.number().int().nonnegative(), OPT_OUT_GLOBAL:z.number().int().nonnegative(), OPT_OUT_CHANNEL:z.number().int().nonnegative() }).strict() }).strict(),
}).strict();
export const manifestSchema = manifestContentSchema.extend({ digest: z.string().regex(/^[0-9a-f]{64}$/u) }).strict();
export type SuppressionEntry = z.infer<typeof suppressionEntrySchema>;
export type SuppressionManifest = z.infer<typeof manifestSchema>;
export type ReconciliationReport = Readonly<{ version: '1.0'; totalEntries: number; validEntries: number; alreadyApplied: number; requiringChange: number; unresolved: number; conflicts: number; result: 'SAFE' | 'BLOCKED'; reason?: string }>;
