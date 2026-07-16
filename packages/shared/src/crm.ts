import { z } from 'zod';
import type { QualificationStatus } from './qualification.js';

export const crmStages = [
  'NOVO', 'EM_VALIDACAO', 'QUALIFICADO', 'CONTATO_PENDENTE', 'CONTATADO',
  'RESPONDEU', 'REUNIAO', 'PROPOSTA', 'GANHO', 'PERDIDO', 'NAO_CONTATAR',
] as const;
export const crmStageSchema = z.enum(crmStages);
export type CrmStage = z.infer<typeof crmStageSchema>;

export const crmPriorities = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] as const;
export const crmPrioritySchema = z.enum(crmPriorities);
export type CrmPriority = z.infer<typeof crmPrioritySchema>;

export const taskStatuses = ['PENDENTE', 'CONCLUIDA', 'CANCELADA'] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const opportunityStatuses = ['ABERTA', 'GANHA', 'PERDIDA'] as const;
export const opportunityStatusSchema = z.enum(opportunityStatuses);
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>;

export const crmTransitionGraph: Readonly<Record<CrmStage, readonly CrmStage[]>> = {
  NOVO: ['EM_VALIDACAO', 'NAO_CONTATAR'],
  EM_VALIDACAO: ['NOVO', 'QUALIFICADO', 'PERDIDO', 'NAO_CONTATAR'],
  QUALIFICADO: ['EM_VALIDACAO', 'CONTATO_PENDENTE', 'PERDIDO', 'NAO_CONTATAR'],
  CONTATO_PENDENTE: ['QUALIFICADO', 'CONTATADO', 'PERDIDO', 'NAO_CONTATAR'],
  CONTATADO: ['CONTATO_PENDENTE', 'RESPONDEU', 'PERDIDO', 'NAO_CONTATAR'],
  RESPONDEU: ['CONTATADO', 'REUNIAO', 'PERDIDO', 'NAO_CONTATAR'],
  REUNIAO: ['RESPONDEU', 'PROPOSTA', 'PERDIDO', 'NAO_CONTATAR'],
  PROPOSTA: ['REUNIAO', 'GANHO', 'PERDIDO', 'NAO_CONTATAR'],
  GANHO: [],
  PERDIDO: [],
  NAO_CONTATAR: [],
};

export const canTransitionCrmStage = (from: CrmStage, to: CrmStage) =>
  crmTransitionGraph[from].includes(to);

export const crmErrorCodes = [
  'NOT_FOUND', 'INVALID_TRANSITION', 'INELIGIBLE_LEAD', 'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT', 'INVALID_REACTIVATION', 'INVALID_INPUT',
] as const;
export type CrmErrorCode = (typeof crmErrorCodes)[number];

export class CrmDomainError extends Error {
  readonly name = 'CrmDomainError';
  constructor(message: string, readonly code: CrmErrorCode) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const nonBlank = (max: number) => z.string().trim().min(1).max(max);
export const entityIdSchema = z.string().uuid();
export const actorSchema = nonBlank(100);
export const reasonSchema = nonBlank(1000);
export const auditMetadataSchema = z.record(z.string(), z.unknown()).refine(
  (value) => Object.keys(value).length > 0,
  'Audit metadata cannot be empty',
);
export const utcDateTimeSchema = z.string().datetime({ offset: false }).refine(
  (value) => value.endsWith('Z'),
  'Date must be UTC and end with Z',
);
export const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/, 'Invalid monetary value');
export const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const expectedVersionSchema = z.number().int().nonnegative();

export const crmReactivationPermission = 'crm:reactivate-do-not-contact' as const;
const trustedAuthorizationContexts = new WeakSet<object>();

export type AuthorizationContext = Readonly<{
  principalId: string;
  permissions: ReadonlySet<string>;
  authenticationMethod: string;
  requestId?: string;
}>;

const readonlySet = <T>(values: Iterable<T>): ReadonlySet<T> => {
  const snapshot = new Set(values);
  const view: ReadonlySet<T> = Object.freeze({
    get size() { return snapshot.size; },
    has: (value: T) => snapshot.has(value),
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    forEach: (callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown) =>
      snapshot.forEach((value) => callback.call(thisArg, value, value, view)),
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
  });
  return view;
};

export function createAuthorizationContext(value: AuthorizationContext): AuthorizationContext {
  const context = Object.freeze({
    principalId: actorSchema.parse(value.principalId),
    permissions: readonlySet(value.permissions),
    authenticationMethod: nonBlank(100).parse(value.authenticationMethod),
    ...(value.requestId ? { requestId: nonBlank(100).parse(value.requestId) } : {}),
  });
  trustedAuthorizationContexts.add(context);
  return context;
}

export const isTrustedAuthorizationContext = (value: unknown): value is AuthorizationContext =>
  typeof value === 'object' && value !== null && trustedAuthorizationContexts.has(value);

const commandSchema = z.object({
  actor: actorSchema,
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: expectedVersionSchema,
}).strict();

export const crmStageChangeSchema = z.object({
  actor: actorSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: expectedVersionSchema,
  stage: crmStageSchema,
  reason: reasonSchema.optional(),
  action: z.enum(['TRANSITION', 'REACTIVATE', 'REOPEN']).default('TRANSITION'),
  auditMetadata: auditMetadataSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.stage === 'NAO_CONTATAR' && !value.reason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Reason is required to enter NAO_CONTATAR' });
  }
  if ((value.action === 'REACTIVATE' || value.action === 'REOPEN') && !value.reason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Reactivation and reopen require a reason' });
  }
});
export type CrmStageChangeInput = z.infer<typeof crmStageChangeSchema>;

export const crmAssignmentUpdateSchema = commandSchema.extend({
  owner: nonBlank(100).nullable().optional(),
  priority: crmPrioritySchema.optional(),
  nextActionAt: utcDateTimeSchema.nullable().optional(),
}).strict().refine(
  (value) => value.owner !== undefined || value.priority !== undefined || value.nextActionAt !== undefined,
  { message: 'At least one CRM assignment field is required' },
);
export type CrmAssignmentUpdateInput = z.infer<typeof crmAssignmentUpdateSchema>;

export function assertCrmTransition(from: CrmStage, input: CrmStageChangeInput, authorization?: AuthorizationContext): void {
  const controlledExit = from === 'NAO_CONTATAR' && input.action === 'REACTIVATE';
  const controlledReopen = (from === 'GANHO' || from === 'PERDIDO') && input.action === 'REOPEN';
  if (controlledExit || controlledReopen) {
    if (!input.reason) {
      throw new CrmDomainError('Controlled transition requires an action and reason', 'INVALID_REACTIVATION');
    }
    if (controlledExit && input.stage !== 'NOVO') {
      throw new CrmDomainError('NAO_CONTATAR can only be reactivated into NOVO', 'INVALID_REACTIVATION');
    }
    if (controlledExit && (!isTrustedAuthorizationContext(authorization)
      || !authorization.permissions.has(crmReactivationPermission))) {
      throw new CrmDomainError('NAO_CONTATAR reactivation requires explicit authorization', 'INVALID_REACTIVATION');
    }
    if (controlledReopen && input.stage !== 'QUALIFICADO') {
      throw new CrmDomainError('Terminal CRM stages can only reopen into QUALIFICADO', 'INVALID_REACTIVATION');
    }
    return;
  }
  if (!canTransitionCrmStage(from, input.stage)) {
    throw new CrmDomainError(`CRM transition from ${from} to ${input.stage} is not allowed`, 'INVALID_TRANSITION');
  }
}

export interface CommercialQueueCandidate {
  qualificationStatus: QualificationStatus;
  crmStage: CrmStage;
  isBlocked: boolean;
  doNotContact: boolean;
}
export const isEligibleForCommercialQueue = (lead: CommercialQueueCandidate) =>
  lead.qualificationStatus === 'SEM_SITE_CONFIRMADO' &&
  !lead.isBlocked &&
  !lead.doNotContact &&
  lead.crmStage !== 'NAO_CONTATAR';

export const opportunityCreateSchema = z.object({
  title: nonBlank(200), value: moneySchema, expectedCloseAt: utcDateTimeSchema.optional(),
  owner: nonBlank(100).optional(), actor: actorSchema, idempotencyKey: idempotencyKeySchema,
}).strict();
export const opportunityUpdateSchema = commandSchema.extend({
  title: nonBlank(200).optional(), value: moneySchema.optional(), status: opportunityStatusSchema.optional(),
  expectedCloseAt: utcDateTimeSchema.nullable().optional(), lossReason: reasonSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'PERDIDA' && !value.lossReason) context.addIssue({ code: z.ZodIssueCode.custom, path: ['lossReason'], message: 'Loss reason is required' });
});
export const noteCreateSchema = z.object({ body: nonBlank(5000), opportunityId: entityIdSchema.optional(), actor: actorSchema, idempotencyKey: idempotencyKeySchema }).strict();
export const tagSchema = z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u);
export const tagMutationSchema = z.object({ actor: actorSchema, idempotencyKey: idempotencyKeySchema }).strict();
export const taskCreateSchema = z.object({
  title: nonBlank(200), description: z.string().trim().max(2000).optional(), dueAt: utcDateTimeSchema,
  priority: crmPrioritySchema.default('MEDIA'), assignee: nonBlank(100).optional(),
  opportunityId: entityIdSchema.optional(), actor: actorSchema, idempotencyKey: idempotencyKeySchema,
}).strict();
export const taskCompleteSchema = commandSchema.extend({ completedAt: utcDateTimeSchema.optional() }).strict();
export const taskRescheduleSchema = commandSchema.extend({ dueAt: utcDateTimeSchema, reason: reasonSchema }).strict();

const pagination = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
export const opportunityListFilterSchema = z.object({ ...pagination, status: opportunityStatusSchema.optional() }).strict();
export const noteListFilterSchema = z.object(pagination).strict();
export const tagListFilterSchema = z.object(pagination).strict();
export const taskListFilterSchema = z.object({ ...pagination, status: taskStatusSchema.optional(), priority: crmPrioritySchema.optional(), dueBefore: utcDateTimeSchema.optional(), dueAfter: utcDateTimeSchema.optional() }).strict();
export const followUpFilterSchema = z.object({ ...pagination, from: utcDateTimeSchema.optional(), to: utcDateTimeSchema.optional(), owner: nonBlank(100).optional() }).strict().refine(
  (value) => !value.from || !value.to || value.from <= value.to,
  { path: ['to'], message: 'to must be on or after from' },
);

export type OpportunityCreateInput = z.infer<typeof opportunityCreateSchema>;
export type OpportunityUpdateInput = z.infer<typeof opportunityUpdateSchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskCompleteInput = z.infer<typeof taskCompleteSchema>;
export type TaskRescheduleInput = z.infer<typeof taskRescheduleSchema>;
