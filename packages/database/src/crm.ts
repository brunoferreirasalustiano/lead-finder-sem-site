import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import {
  assertCrmTransition, CrmDomainError, isEligibleForCommercialQueue,
  isTrustedAuthorizationContext, legacyCrmStageReplayPayload, type AuthorizationContext,
  type CrmPriority, type CrmStageChangeInput,
  type NoteCreateInput, type OpportunityCreateInput, type OpportunityUpdateInput,
  type TaskCompleteInput, type TaskCreateInput, type TaskRescheduleInput,
} from '@lead-finder/shared';
import type { Database } from './index.js';
import { safeLeadSelection } from './safe-projections.js';
import {
  safeLeadMutationResult,
  safeNoteMutationResult,
  safeOpportunityMutationResult,
  safeTagMutationResult,
  safeTaskMutationResult,
} from './crm-mutation-projections.js';
import {
  crmIdempotencyKeys, crmLeadTags, crmNotes, crmOpportunities, crmTags, crmTasks,
  crmTimelineEvents, leads,
} from './schema.js';

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const matchesReplayFingerprint = (stored: string, payload: unknown, legacyPayload?: unknown) =>
  stored === fingerprint(payload)
  || (legacyPayload !== undefined && stored === fingerprint(legacyPayload));
const normalizeTag = (value: string) => value.trim().toLocaleLowerCase('pt-BR');
const hasPostgresCode = (error: unknown, code: string): boolean => {
  let current = error;
  while (current && typeof current === 'object') {
    if ((current as { code?: string }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type MutationResult<T> = { data: T; replayed: boolean };
export interface ListOptions { limit?: number; offset?: number }
export const normalizeListOptions = ({ limit = 20, offset = 0 }: ListOptions = {}) => {
  const safeLimit = Number.isFinite(limit) ? Math.trunc(limit) : 20;
  const safeOffset = Number.isFinite(offset) ? Math.trunc(offset) : 0;
  return { limit: Math.min(100, Math.max(1, safeLimit)), offset: Math.max(0, safeOffset) };
};
type LeadMutation = ReturnType<typeof safeLeadMutationResult>;
type OpportunityMutation = ReturnType<typeof safeOpportunityMutationResult>;
type NoteMutation = ReturnType<typeof safeNoteMutationResult>;
type TaskMutation = ReturnType<typeof safeTaskMutationResult>;
type TagMutation = ReturnType<typeof safeTagMutationResult>;

async function requireCommercialLead(tx: Tx, leadId: string, lock = false) {
  const query = tx.select().from(leads).where(eq(leads.id, leadId));
  const rows = lock ? await query.for('update').limit(1) : await query.limit(1);
  const lead = rows[0];
  if (!lead) throw new CrmDomainError('Lead not found', 'NOT_FOUND');
  const stage = lead.crmStage ?? 'NOVO';
  if (!isEligibleForCommercialQueue({ ...lead, crmStage: stage }))
    throw new CrmDomainError('Lead is not eligible for commercial operations', 'INELIGIBLE_LEAD');
  return { ...lead, crmStage: stage };
}

async function requireOpportunityForLead(tx: Tx, leadId: string, opportunityId?: string) {
  if (!opportunityId) return;
  const opportunity = (await tx.select({ id: crmOpportunities.id }).from(crmOpportunities).where(and(
    eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.leadId, leadId),
  )).limit(1))[0];
  if (!opportunity) throw new CrmDomainError('Opportunity not found for lead', 'NOT_FOUND');
}

async function replay<T>(tx: Tx, scope: string, key: string, payload: unknown, legacyPayload?: unknown): Promise<MutationResult<T> | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${scope}:${key}`}))`);
  const existing = (await tx.select().from(crmIdempotencyKeys).where(and(
    eq(crmIdempotencyKeys.scope, scope), eq(crmIdempotencyKeys.idempotencyKey, key),
  )).limit(1))[0];
  if (!existing) return null;
  if (!matchesReplayFingerprint(existing.payloadFingerprint, payload, legacyPayload))
    throw new CrmDomainError('Idempotency key was used with a different payload', 'IDEMPOTENCY_CONFLICT');
  return { data: existing.result as T, replayed: true };
}
async function remember(tx: Tx, scope: string, key: string, payload: unknown, type: string, id: string, result: unknown) {
  await tx.insert(crmIdempotencyKeys).values({ scope, idempotencyKey: key, payloadFingerprint: fingerprint(payload), resourceType: type, resourceId: id, result });
}
const event = (tx: Tx, value: typeof crmTimelineEvents.$inferInsert) => tx.insert(crmTimelineEvents).values(value);

export async function getCrm(db: Database, leadId: string) {
  const lead = (await db.select(safeLeadSelection).from(leads).where(eq(leads.id, leadId)).limit(1))[0];
  if (!lead) throw new CrmDomainError('Lead not found', 'NOT_FOUND');
  const [opportunities, notes, tags, tasks] = await Promise.all([
    listOpportunities(db, leadId), listNotes(db, leadId), listTags(db, leadId), listTasks(db, leadId),
  ]);
  return { lead: { ...lead, crmStage: lead.crmStage ?? 'NOVO' }, opportunities, notes, tags, tasks };
}

export async function createOpportunity(db: Database, leadId: string, input: OpportunityCreateInput) {
  return db.transaction(async (tx) => {
    const scope = `lead:${leadId}:opportunity:create`;
    const old = await replay<OpportunityMutation>(tx, scope, input.idempotencyKey, input); if (old) return old;
    await requireCommercialLead(tx, leadId, true);
    const row = (await tx.insert(crmOpportunities).values({ leadId, title: input.title, amount: input.value, expectedCloseAt: input.expectedCloseAt ? new Date(input.expectedCloseAt) : null, owner: input.owner }).returning())[0]!;
    await event(tx, { leadId, opportunityId: row.id, eventType: 'OPPORTUNITY_CREATED', actor: input.actor, newValue: row });
    const data = safeOpportunityMutationResult(row);
    await remember(tx, scope, input.idempotencyKey, input, 'opportunity', row.id, data);
    return { data, replayed: false };
  });
}
export const listOpportunities = (db: Database, leadId: string, options?: ListOptions) => { const page = normalizeListOptions(options); return db.select().from(crmOpportunities).where(eq(crmOpportunities.leadId, leadId)).orderBy(desc(crmOpportunities.updatedAt), desc(crmOpportunities.id)).limit(page.limit).offset(page.offset); };

export async function updateOpportunity(db: Database, opportunityId: string, input: OpportunityUpdateInput) {
  return db.transaction(async (tx) => {
    const scope = `opportunity:${opportunityId}:update`;
    const old = await replay<OpportunityMutation>(tx, scope, input.idempotencyKey, input); if (old) return old;
    const current = (await tx.select().from(crmOpportunities).where(eq(crmOpportunities.id, opportunityId)).limit(1))[0];
    if (!current) throw new CrmDomainError('Opportunity not found', 'NOT_FOUND');
    await requireCommercialLead(tx, current.leadId, true);
    const outcome = input.status === undefined ? undefined : input.status === 'GANHA' ? 'GANHO' : input.status === 'PERDIDA' ? 'PERDIDO' : null;
    const row = (await tx.update(crmOpportunities).set({ title: input.title, amount: input.value, expectedCloseAt: input.expectedCloseAt === undefined ? undefined : input.expectedCloseAt === null ? null : new Date(input.expectedCloseAt), outcome, closedAt: outcome === undefined ? undefined : outcome ? new Date() : null, lossReason: input.lossReason === undefined ? (input.status === 'ABERTA' ? null : undefined) : input.lossReason, version: sql`${crmOpportunities.version} + 1`, updatedAt: new Date() }).where(and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.version, input.expectedVersion))).returning())[0];
    if (!row) throw new CrmDomainError('Opportunity version conflict', 'VERSION_CONFLICT');
    await event(tx, { leadId: row.leadId, opportunityId, eventType: 'OPPORTUNITY_UPDATED', actor: input.actor, previousValue: current, newValue: row });
    const data = safeOpportunityMutationResult(row);
    await remember(tx, scope, input.idempotencyKey, input, 'opportunity', row.id, data);
    return { data, replayed: false };
  });
}

export async function changeCrmStage(db: Database, leadId: string, command: CrmStageChangeInput, authorization: AuthorizationContext) {
  if (!isTrustedAuthorizationContext(authorization))
    throw new CrmDomainError('Trusted authorization context is required', 'INVALID_REACTIVATION');
  const replayPayload = {
    stage: command.stage,
    reason: command.reason,
    action: command.action,
    expectedVersion: command.expectedVersion,
    principalId: authorization.principalId,
    authenticationMethod: authorization.authenticationMethod,
  };
  return db.transaction(async (tx) => {
    const scope = `lead:${leadId}:stage`;
    const old = await replay<LeadMutation>(
      tx, scope, command.idempotencyKey, replayPayload,
      legacyCrmStageReplayPayload(command, authorization),
    ); if (old) return old;
    const current = (await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0];
    if (!current) throw new CrmDomainError('Lead not found', 'NOT_FOUND');
    const from = current.crmStage ?? 'NOVO';
    if (from !== 'NAO_CONTATAR') await requireCommercialLead(tx, leadId);
    else if (current.qualificationStatus !== 'SEM_SITE_CONFIRMADO' || current.isBlocked || current.doNotContact)
      throw new CrmDomainError('Lead is not eligible for commercial reactivation', 'INELIGIBLE_LEAD');
    assertCrmTransition(from, command, authorization);
    const auditTimestamp = new Date();
    const auditMetadata = command.action === 'REACTIVATE' || command.action === 'REOPEN' ? {
      action: command.action,
      principalId: authorization.principalId,
      authenticationMethod: authorization.authenticationMethod,
      ...(authorization.requestId ? { requestId: authorization.requestId } : {}),
      source: 'authenticated-api',
      timestamp: auditTimestamp.toISOString(),
    } : {};
    const row = (await tx.update(leads).set({ crmStage: command.stage, crmVersion: sql`${leads.crmVersion} + 1`, crmUpdatedAt: auditTimestamp, updatedAt: auditTimestamp }).where(and(eq(leads.id, leadId), eq(leads.crmVersion, command.expectedVersion))).returning())[0];
    if (!row) throw new CrmDomainError('Lead CRM version conflict', 'VERSION_CONFLICT');
    await event(tx, { leadId, eventType: 'STAGE_CHANGED', actor: authorization.principalId, reason: command.reason, previousValue: { stage: from, version: current.crmVersion }, newValue: { stage: row.crmStage, version: row.crmVersion }, metadata: auditMetadata, createdAt: auditTimestamp });
    const data = safeLeadMutationResult(row);
    await remember(tx, scope, command.idempotencyKey, replayPayload, 'lead', leadId, data);
    return { data, replayed: false };
  });
}

export async function updateCrmAssignment(db: Database, leadId: string, input: { owner?: string | null | undefined; priority?: CrmPriority | undefined; nextActionAt?: Date | null | undefined; actor: string; expectedVersion: number; idempotencyKey: string }) {
  return db.transaction(async (tx) => {
    const scope = `lead:${leadId}:assignment`; const old = await replay<LeadMutation>(tx, scope, input.idempotencyKey, input); if (old) return old;
    const current = await requireCommercialLead(tx, leadId);
    const row = (await tx.update(leads).set({ crmOwner: input.owner, crmPriority: input.priority, crmNextActionAt: input.nextActionAt, crmVersion: sql`${leads.crmVersion} + 1`, crmUpdatedAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.crmVersion, input.expectedVersion))).returning())[0];
    if (!row) throw new CrmDomainError('Lead CRM version conflict', 'VERSION_CONFLICT');
    await event(tx, { leadId, eventType: 'ASSIGNMENT_UPDATED', actor: input.actor, previousValue: current, newValue: row });
    const data = safeLeadMutationResult(row);
    await remember(tx, scope, input.idempotencyKey, input, 'lead', leadId, data);
    return { data, replayed: false };
  });
}

export async function addNote(db: Database, leadId: string, input: NoteCreateInput & { opportunityId?: string | undefined }) {
  return db.transaction(async (tx) => { const scope = `lead:${leadId}:note`; const old = await replay<NoteMutation>(tx, scope, input.idempotencyKey, input); if (old) return old; await requireCommercialLead(tx, leadId); await requireOpportunityForLead(tx, leadId, input.opportunityId);
    const row = (await tx.insert(crmNotes).values({ leadId, opportunityId: input.opportunityId, body: input.body, author: input.actor }).returning())[0]!;
    await event(tx, { leadId, opportunityId: input.opportunityId, eventType: 'NOTE_ADDED', actor: input.actor, newValue: row }); const data = safeNoteMutationResult(row); await remember(tx, scope, input.idempotencyKey, input, 'note', row.id, data); return { data, replayed: false }; });
}
export const listNotes = (db: Database, leadId: string, options?: ListOptions) => { const page = normalizeListOptions(options); return db.select().from(crmNotes).where(eq(crmNotes.leadId, leadId)).orderBy(desc(crmNotes.createdAt), desc(crmNotes.id)).limit(page.limit).offset(page.offset); };

export async function addTag(db: Database, leadId: string, name: string, input: { actor: string; idempotencyKey: string }) {
  return db.transaction(async (tx) => { const payload = { name, ...input }; const scope = `lead:${leadId}:tag:add`; const old = await replay<TagMutation>(tx, scope, input.idempotencyKey, payload); if (old) return old; await requireCommercialLead(tx, leadId);
    const tag = (await tx.insert(crmTags).values({ name: name.trim(), normalizedName: normalizeTag(name) }).onConflictDoUpdate({ target: crmTags.normalizedName, set: { name: name.trim() } }).returning())[0]!;
    const association = await tx.insert(crmLeadTags).values({ leadId, tagId: tag.id, actor: input.actor }).onConflictDoNothing().returning({ tagId: crmLeadTags.tagId });
    const result = { ...tag, leadId };
    if (association.length > 0) await event(tx, { leadId, eventType: 'TAG_ADDED', actor: input.actor, newValue: result });
    const data = safeTagMutationResult(result); await remember(tx, scope, input.idempotencyKey, payload, 'tag', tag.id, data); return { data, replayed: false }; });
}
export async function removeTag(db: Database, leadId: string, name: string, input: { actor: string; idempotencyKey: string }) {
  return db.transaction(async (tx) => { const payload = { name, ...input }; const scope = `lead:${leadId}:tag:remove`; const old = await replay<TagMutation>(tx, scope, input.idempotencyKey, payload); if (old) return old; await requireCommercialLead(tx, leadId);
    const tag = (await tx.select().from(crmTags).where(eq(crmTags.normalizedName, normalizeTag(name))).limit(1))[0]; if (!tag) throw new CrmDomainError('Tag not found', 'NOT_FOUND');
    const removed = await tx.delete(crmLeadTags).where(and(eq(crmLeadTags.leadId, leadId), eq(crmLeadTags.tagId, tag.id))).returning({ tagId: crmLeadTags.tagId });
    if (removed.length === 0) throw new CrmDomainError('Tag is not assigned to lead', 'NOT_FOUND');
    const result = { removed: true, tagId: tag.id, leadId };
    await event(tx, { leadId, eventType: 'TAG_REMOVED', actor: input.actor, newValue: result }); const data = safeTagMutationResult(result); await remember(tx, scope, input.idempotencyKey, payload, 'tag', tag.id, data); return { data, replayed: false }; });
}
export const listTags = (db: Database, leadId: string, options?: ListOptions) => { const page = normalizeListOptions(options); return db.select({ id: crmTags.id, name: crmTags.name, createdAt: crmLeadTags.createdAt }).from(crmLeadTags).innerJoin(crmTags, eq(crmTags.id, crmLeadTags.tagId)).where(eq(crmLeadTags.leadId, leadId)).orderBy(asc(crmTags.name)).limit(page.limit).offset(page.offset); };

export async function createTask(db: Database, leadId: string, input: TaskCreateInput & { opportunityId?: string | undefined }) {
  return db.transaction(async (tx) => { const scope = `lead:${leadId}:task:create`; const old = await replay<TaskMutation>(tx, scope, input.idempotencyKey, input); if (old) return old; await requireCommercialLead(tx, leadId); await requireOpportunityForLead(tx, leadId, input.opportunityId);
    const row = (await tx.insert(crmTasks).values({ leadId, opportunityId: input.opportunityId, title: input.title, description: input.description, dueAt: new Date(input.dueAt), priority: input.priority, owner: input.assignee }).returning())[0]!;
    await event(tx, { leadId, taskId: row.id, opportunityId: input.opportunityId, eventType: 'TASK_CREATED', actor: input.actor, newValue: row }); const data = safeTaskMutationResult(row); await remember(tx, scope, input.idempotencyKey, input, 'task', row.id, data); return { data, replayed: false }; });
}
export const listTasks = (db: Database, leadId: string, options?: ListOptions) => { const page = normalizeListOptions(options); return db.select().from(crmTasks).where(eq(crmTasks.leadId, leadId)).orderBy(asc(crmTasks.dueAt), asc(crmTasks.id)).limit(page.limit).offset(page.offset); };
async function mutateTask(db: Database, taskId: string, input: TaskCompleteInput | TaskRescheduleInput, kind: 'complete' | 'reschedule') {
  return db.transaction(async (tx) => { const scope = `task:${taskId}:${kind}`; const old = await replay<TaskMutation>(tx, scope, input.idempotencyKey, input); if (old) return old;
    const current = (await tx.select().from(crmTasks).where(eq(crmTasks.id, taskId)).limit(1))[0]; if (!current) throw new CrmDomainError('Task not found', 'NOT_FOUND'); await requireCommercialLead(tx, current.leadId);
    const complete = kind === 'complete'; const dueAt = 'dueAt' in input ? new Date(input.dueAt) : current.dueAt;
    const completedAt = complete && 'completedAt' in input ? new Date(input.completedAt ?? new Date().toISOString()) : complete ? new Date() : null;
    const row = (await tx.update(crmTasks).set({ status: complete ? 'CONCLUIDA' : 'PENDENTE', completedAt, dueAt, version: sql`${crmTasks.version} + 1`, updatedAt: new Date() }).where(and(eq(crmTasks.id, taskId), eq(crmTasks.version, input.expectedVersion), eq(crmTasks.status, 'PENDENTE'))).returning())[0];
    if (!row) throw new CrmDomainError('Task version or state conflict', 'VERSION_CONFLICT'); await event(tx, { leadId: row.leadId, taskId, eventType: complete ? 'TASK_COMPLETED' : 'TASK_RESCHEDULED', actor: input.actor, reason: 'reason' in input ? input.reason : undefined, previousValue: current, newValue: row }); const data = safeTaskMutationResult(row); await remember(tx, scope, input.idempotencyKey, input, 'task', row.id, data); return { data, replayed: false }; });
}
export const completeTask = (db: Database, taskId: string, input: TaskCompleteInput) => mutateTask(db, taskId, input, 'complete');
export const rescheduleTask = (db: Database, taskId: string, input: TaskRescheduleInput) => mutateTask(db, taskId, input, 'reschedule');
export const listTimeline = (db: Database, leadId: string, options?: ListOptions) => { const page = normalizeListOptions(options); return db.select().from(crmTimelineEvents).where(eq(crmTimelineEvents.leadId, leadId)).orderBy(desc(crmTimelineEvents.createdAt), desc(crmTimelineEvents.id)).limit(page.limit).offset(page.offset); };

const queueEligibility = and(eq(leads.qualificationStatus, 'SEM_SITE_CONFIRMADO'), eq(leads.isBlocked, false), eq(leads.doNotContact, false), sql`${leads.crmStage} is distinct from 'NAO_CONTATAR'::crm_stage`);
export function listOverdueTasks(db: Database, now: Date, limit = 100) { return db.select({ task: crmTasks, lead: leads }).from(crmTasks).innerJoin(leads, eq(leads.id, crmTasks.leadId)).where(and(eq(crmTasks.status, 'PENDENTE'), lt(crmTasks.dueAt, now), queueEligibility)).orderBy(asc(crmTasks.dueAt), asc(crmTasks.id)).limit(limit); }
export function listUpcomingFollowUps(db: Database, from: Date, to: Date, limit = 100, owner?: string) { return db.select({ task: crmTasks, lead: leads }).from(crmTasks).innerJoin(leads, eq(leads.id, crmTasks.leadId)).where(and(eq(crmTasks.status, 'PENDENTE'), gte(crmTasks.dueAt, from), lte(crmTasks.dueAt, to), owner ? eq(crmTasks.owner, owner) : undefined, queueEligibility)).orderBy(asc(crmTasks.dueAt), asc(crmTasks.id)).limit(limit); }

export { hasPostgresCode };
