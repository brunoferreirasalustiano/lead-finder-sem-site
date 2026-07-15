import Fastify from 'fastify';
import {
  getOperationalSnapshot,
  getReadiness,
  enqueueCollection,
  getLead,
  listLeads,
  addEvidence,
  getQualification,
  listContacts,
  listEvidence,
  listHistory,
  QualificationError,
  addNote,
  addTag,
  changeCrmStage,
  completeTask,
  createOpportunity,
  createTask,
  getCrm,
  listNotes,
  listOpportunities,
  listOverdueTasks,
  listTags,
  listTasks,
  listTimeline,
  listUpcomingFollowUps,
  removeTag,
  rescheduleTask,
  updateOpportunity,
  updateCrmAssignment,
  updateQualification,
  upsertContact,
  type Database,
  CampaignPersistenceError,
  createAttemptWithOutbox,
  createCampaignVersion,
  createCampaignWithVersion,
  getCampaign,
  listCampaignAudit,
  listCampaigns,
  listCampaignFailures,
  listCampaignRecipients,
  listCampaignTemplates,
  listCampaignVersions,
  listEligibleCampaignLeads,
  listRecipientAttempts,
  reserveSimulatedRecipient,
  transitionCampaign,
  transitionCampaignVersion,
} from '@lead-finder/database';
import {
  collectSchema,
  contactInputSchema,
  evidenceInputSchema,
  listLeadsSchema,
  qualificationUpdateSchema,
  crmStageChangeSchema,
  crmAssignmentUpdateSchema,
  CrmDomainError,
  followUpFilterSchema,
  noteCreateSchema,
  noteListFilterSchema,
  opportunityCreateSchema,
  opportunityListFilterSchema,
  opportunityUpdateSchema,
  tagListFilterSchema,
  tagMutationSchema,
  tagSchema,
  taskCompleteSchema,
  taskCreateSchema,
  taskListFilterSchema,
  taskRescheduleSchema,
  CampaignDomainError,
  campaignApprovalSchema,
  campaignCreateSchema,
  campaignEligibleListSchema,
  campaignListSchema,
  campaignPreviewSchema,
  campaignSimulationSchema,
  campaignStateCommandSchema,
  campaignVersionCreateSchema,
  defineCampaignTemplate,
} from '@lead-finder/shared';
import { z } from 'zod';
import { simulateCampaignMessage } from './campaign-simulation.js';

const idSchema = z.string().uuid();
export const csvCell = (value: string | number | boolean | Date | null | undefined) => {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? '');
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};
export const creationStatus = (replayed: boolean) => replayed ? 200 : 201;
export function buildApp(db: Database, options: { dailyLeadLimit?: number; operationalBacklogDegradedCount?: number; operationalOldestPendingDegradedMs?: number } = {}) {
  const dailyLeadLimit = options.dailyLeadLimit ?? 50;
  const app = Fastify({ logger: true, bodyLimit: 16_384, requestTimeout: 15_000 });
  app.get('/health/live', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  const ready = async (
    _request: unknown,
    reply: { status: (code: number) => { send: (body: object) => unknown } },
  ) => {
    try {
      const readiness = await getReadiness(db, {
        backlogCount: options.operationalBacklogDegradedCount ?? 100,
        oldestPendingAgeMs: options.operationalOldestPendingDegradedMs ?? 300_000,
      });
      if (readiness.status === 'unhealthy') return reply.status(503).send({ error: 'Service unavailable', code: 'DATABASE_UNAVAILABLE' });
      return { status: readiness.status, timestamp: new Date().toISOString(), snapshot: readiness.snapshot };
    } catch {
      return reply.status(503).send({ error: 'Service unavailable', code: 'DATABASE_UNAVAILABLE' });
    }
  };
  app.get('/health', ready);
  app.get('/health/ready', ready);
  app.get('/internal/operational-snapshot', async (_request, reply) => {
    try { return await getOperationalSnapshot(db); }
    catch { return reply.status(503).send({ error: 'Service unavailable', code: 'DATABASE_UNAVAILABLE' }); }
  });
  app.get('/leads', async (request, reply) => {
    const parsed = listLeadsSchema.safeParse(request.query);
    if (!parsed.success)
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    return listLeads(db, parsed.data);
  });
  app.get('/leads/:id', async (request, reply) => {
    const parsed = idSchema.safeParse((request.params as { id?: unknown }).id);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid id' });
    const lead = await getLead(db, parsed.data);
    return lead ?? reply.status(404).send({ error: 'Lead not found' });
  });
  const qualificationError = (
    error: unknown,
    reply: { status: (code: number) => { send: (body: object) => unknown } },
  ) => {
    if (!(error instanceof QualificationError)) throw error;
    const status =
      error.code === 'NOT_FOUND' ? 404 : error.code === 'DUPLICATE_CONTACT' ? 409 : 422;
    return reply.status(status).send({ error: error.message, code: error.code });
  };
  const leadId = (request: { params: unknown }) =>
    idSchema.safeParse((request.params as { id?: unknown }).id);
  const crmError = (
    error: unknown,
    reply: { status: (code: number) => { send: (body: object) => unknown } },
  ) => {
    if (!(error instanceof CrmDomainError)) throw error;
    const status = error.code === 'NOT_FOUND' ? 404
      : error.code === 'VERSION_CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 422;
    return reply.status(status).send({ error: error.message, code: error.code });
  };
  const parseId = (params: unknown, key = 'id') =>
    idSchema.safeParse((params as Record<string, unknown>)[key]);
  const listOptions = (query: { page: number; pageSize: number }) => ({
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  });
  const page = <T>(items: T[], query: { page: number; pageSize: number }) => ({
    items,
    pagination: { page: query.page, pageSize: query.pageSize, hasMore: items.length === query.pageSize },
  });
  const crmRoute = async <T>(reply: Parameters<typeof crmError>[1], operation: () => Promise<T>) => {
    try { return await operation(); } catch (error) { return crmError(error, reply); }
  };
  const campaignError = (error: unknown, reply: Parameters<typeof crmError>[1]) => {
    if (error instanceof CampaignPersistenceError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'IDEMPOTENCY_CONFLICT' || error.code === 'LOGICAL_CONFLICT' || error.code === 'VERSION_CONFLICT' ? 409 : 422;
      return reply.status(status).send({ error: error.message, code: error.code });
    }
    if (error instanceof CampaignDomainError) return reply.status(422).send({ error: error.message, code: error.code });
    throw error;
  };
  const campaignRoute = async <T>(reply: Parameters<typeof crmError>[1], operation: () => Promise<T>) => {
    try { return await operation(); } catch (error) { return campaignError(error, reply); }
  };
  const idempotencyKey = (headers: Record<string, unknown>) => z.string().trim().min(1).max(200).safeParse(headers['idempotency-key']);
  app.get('/leads/:id/qualification', async (request, reply) => {
    const id = leadId(request);
    if (!id.success) return reply.status(400).send({ error: 'Invalid id' });
    try {
      return {
        ...(await getQualification(db, id.data)),
        evidence: await listEvidence(db, id.data),
      };
    } catch (error) {
      return qualificationError(error, reply);
    }
  });
  app.post('/leads/:id/evidence', async (request, reply) => {
    const id = leadId(request);
    const body = evidenceInputSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid evidence' });
    try {
      return reply.status(201).send(await addEvidence(db, id.data, body.data));
    } catch (error) {
      return qualificationError(error, reply);
    }
  });
  app.put('/leads/:id/contacts', async (request, reply) => {
    const id = leadId(request);
    const body = contactInputSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid contact' });
    try {
      return await upsertContact(db, id.data, body.data);
    } catch (error) {
      return qualificationError(error, reply);
    }
  });
  app.get('/leads/:id/contacts', async (request, reply) => {
    const id = leadId(request);
    if (!id.success) return reply.status(400).send({ error: 'Invalid id' });
    try {
      await getQualification(db, id.data);
      return listContacts(db, id.data);
    } catch (error) {
      return qualificationError(error, reply);
    }
  });
  app.patch('/leads/:id/qualification', async (request, reply) => {
    const id = leadId(request);
    const body = qualificationUpdateSchema.safeParse(request.body);
    if (!id.success || !body.success)
      return reply.status(400).send({ error: 'Invalid qualification update' });
    try {
      return await updateQualification(db, id.data, body.data);
    } catch (error) {
      return qualificationError(error, reply);
    }
  });
  app.get('/leads/:id/history', async (request, reply) => {
    const id = leadId(request);
    if (!id.success) return reply.status(400).send({ error: 'Invalid id' });
    try {
      await getQualification(db, id.data);
      return listHistory(db, id.data);
    } catch (error) {
      return qualificationError(error, reply);
    }
  });
  app.get('/leads/:id/crm', async (request, reply) => {
    const id = leadId(request); if (!id.success) return reply.status(400).send({ error: 'Invalid id' });
    return crmRoute(reply, () => getCrm(db, id.data));
  });
  app.patch('/leads/:id/crm/stage', async (request, reply) => {
    const id = leadId(request); const body = crmStageChangeSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid CRM stage change', details: body.success ? undefined : body.error.flatten() });
    return crmRoute(reply, async () => (await changeCrmStage(db, id.data, body.data)).data);
  });
  app.patch('/leads/:id/crm', async (request, reply) => {
    const id = leadId(request); const body = crmAssignmentUpdateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid CRM assignment update' });
    const { nextActionAt, ...input } = body.data;
    return crmRoute(reply, async () => (await updateCrmAssignment(db, id.data, {
      ...input,
      nextActionAt: nextActionAt === undefined ? undefined : nextActionAt === null ? null : new Date(nextActionAt),
    })).data);
  });
  app.get('/leads/:id/opportunities', async (request, reply) => {
    const id = leadId(request); const query = opportunityListFilterSchema.safeParse(request.query);
    if (!id.success || !query.success) return reply.status(400).send({ error: 'Invalid opportunity query' });
    const outcome = query.data.status === 'GANHA' ? 'GANHO' : query.data.status === 'PERDIDA' ? 'PERDIDO' : null;
    return crmRoute(reply, async () => page((await listOpportunities(db, id.data, listOptions(query.data))).filter((item) => !query.data.status || item.outcome === outcome), query.data));
  });
  app.post('/leads/:id/opportunities', async (request, reply) => {
    const id = leadId(request); const body = opportunityCreateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid opportunity' });
    return crmRoute(reply, async () => { const result = await createOpportunity(db, id.data, body.data); return reply.status(creationStatus(result.replayed)).send(result.data); });
  });
  app.patch('/opportunities/:id', async (request, reply) => {
    const id = parseId(request.params); const body = opportunityUpdateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid opportunity update' });
    return crmRoute(reply, async () => (await updateOpportunity(db, id.data, body.data)).data);
  });
  app.get('/leads/:id/notes', async (request, reply) => {
    const id = leadId(request); const query = noteListFilterSchema.safeParse(request.query);
    if (!id.success || !query.success) return reply.status(400).send({ error: 'Invalid note query' });
    return crmRoute(reply, async () => page(await listNotes(db, id.data, listOptions(query.data)), query.data));
  });
  app.post('/leads/:id/notes', async (request, reply) => {
    const id = leadId(request); const body = noteCreateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid note' });
    return crmRoute(reply, async () => { const result = await addNote(db, id.data, body.data); return reply.status(creationStatus(result.replayed)).send(result.data); });
  });
  app.get('/leads/:id/tags', async (request, reply) => {
    const id = leadId(request); const query = tagListFilterSchema.safeParse(request.query);
    if (!id.success || !query.success) return reply.status(400).send({ error: 'Invalid tag query' });
    return crmRoute(reply, async () => page(await listTags(db, id.data, listOptions(query.data)), query.data));
  });
  for (const method of ['PUT', 'DELETE'] as const) app.route({ method, url: '/leads/:id/tags/:tag', handler: async (request, reply) => {
    const id = leadId(request); const tag = tagSchema.safeParse((request.params as { tag?: unknown }).tag); const body = tagMutationSchema.safeParse(request.body);
    if (!id.success || !tag.success || !body.success) return reply.status(400).send({ error: 'Invalid tag mutation' });
    return crmRoute(reply, async () => (await (method === 'PUT' ? addTag(db, id.data, tag.data, body.data) : removeTag(db, id.data, tag.data, body.data))).data);
  }});
  app.get('/leads/:id/tasks', async (request, reply) => {
    const id = leadId(request); const query = taskListFilterSchema.safeParse(request.query);
    if (!id.success || !query.success) return reply.status(400).send({ error: 'Invalid task query' });
    return crmRoute(reply, async () => page((await listTasks(db, id.data, listOptions(query.data))).filter((item) => (!query.data.status || item.status === query.data.status) && (!query.data.priority || item.priority === query.data.priority) && (!query.data.dueAfter || item.dueAt >= new Date(query.data.dueAfter)) && (!query.data.dueBefore || item.dueAt <= new Date(query.data.dueBefore))), query.data));
  });
  app.post('/leads/:id/tasks', async (request, reply) => {
    const id = leadId(request); const body = taskCreateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid task' });
    return crmRoute(reply, async () => { const result = await createTask(db, id.data, body.data); return reply.status(creationStatus(result.replayed)).send(result.data); });
  });
  app.patch('/tasks/:id/complete', async (request, reply) => {
    const id = parseId(request.params); const body = taskCompleteSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid task completion' });
    return crmRoute(reply, async () => (await completeTask(db, id.data, body.data)).data);
  });
  app.patch('/tasks/:id/reschedule', async (request, reply) => {
    const id = parseId(request.params); const body = taskRescheduleSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.status(400).send({ error: 'Invalid task reschedule' });
    return crmRoute(reply, async () => (await rescheduleTask(db, id.data, body.data)).data);
  });
  app.get('/leads/:id/timeline', async (request, reply) => {
    const id = leadId(request); const query = noteListFilterSchema.safeParse(request.query);
    if (!id.success || !query.success) return reply.status(400).send({ error: 'Invalid timeline query' });
    return crmRoute(reply, async () => page(await listTimeline(db, id.data, listOptions(query.data)), query.data));
  });
  app.get('/crm/tasks/overdue', async (request, reply) => {
    const query = followUpFilterSchema.safeParse(request.query); if (!query.success) return reply.status(400).send({ error: 'Invalid overdue query' });
    const now = query.data.to ?? query.data.from; if (!now) return reply.status(400).send({ error: 'A deterministic UTC from or to timestamp is required' });
    return crmRoute(reply, () => listOverdueTasks(db, new Date(now), query.data.pageSize));
  });
  app.get('/crm/follow-ups/upcoming', async (request, reply) => {
    const query = followUpFilterSchema.safeParse(request.query); if (!query.success || !query.data.from || !query.data.to) return reply.status(400).send({ error: 'Valid UTC from and to timestamps are required' });
    return crmRoute(reply, () => listUpcomingFollowUps(db, new Date(query.data.from!), new Date(query.data.to!), query.data.pageSize, query.data.owner));
  });
  app.post('/campaigns/preview', async (request, reply) => {
    const body = campaignPreviewSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Invalid campaign preview', code: 'INVALID_REQUEST' });
    try { return simulateCampaignMessage(body.data); }
    catch (error) { return campaignError(error, reply); }
  });
  app.post('/campaigns', async (request, reply) => {
    const body = campaignCreateSchema.safeParse(request.body); const key = idempotencyKey(request.headers);
    if (!body.success || !key.success) return reply.status(400).send({ error: 'Invalid campaign or Idempotency-Key', code: 'INVALID_REQUEST' });
    return campaignRoute(reply, async () => { defineCampaignTemplate(body.data.content, body.data.allowedVariables); const result = await createCampaignWithVersion(db, { ...body.data, idempotencyKey: key.data }); return reply.status(creationStatus(result.replayed)).send(result.data); });
  });
  app.get('/campaigns/:id', async (request, reply) => {
    const id = parseId(request.params); if (!id.success) return reply.status(400).send({ error: 'Invalid campaign id', code: 'INVALID_REQUEST' });
    return campaignRoute(reply, () => getCampaign(db, id.data));
  });
  app.get('/campaigns', async (request, reply) => {
    const query = campaignListSchema.safeParse(request.query); if (!query.success) return reply.status(400).send({ error: 'Invalid campaign query', code: 'INVALID_REQUEST' });
    return page(await listCampaigns(db, query.data.pageSize, (query.data.page - 1) * query.data.pageSize), query.data);
  });
  app.post('/campaigns/:id/versions', async (request, reply) => {
    const id = parseId(request.params); const body = campaignVersionCreateSchema.safeParse(request.body); const key = idempotencyKey(request.headers);
    if (!id.success || !body.success || !key.success) return reply.status(400).send({ error: 'Invalid campaign version', code: 'INVALID_REQUEST' });
    return campaignRoute(reply, async () => { defineCampaignTemplate(body.data.content, body.data.allowedVariables); const result = await createCampaignVersion(db, { campaignId: id.data, ...body.data, idempotencyKey: key.data }); return reply.status(creationStatus(result.replayed)).send(result.data); });
  });
  app.get('/campaigns/:id/versions', async (request, reply) => {
    const id = parseId(request.params); if (!id.success) return reply.status(400).send({ error: 'Invalid campaign id', code: 'INVALID_REQUEST' });
    return campaignRoute(reply, () => listCampaignVersions(db, id.data));
  });
  app.get('/campaign-versions/:id/templates', async (request, reply) => {
    const id = parseId(request.params); if (!id.success) return reply.status(400).send({ error: 'Invalid campaign version id', code: 'INVALID_REQUEST' });
    return campaignRoute(reply, () => listCampaignTemplates(db, id.data));
  });
  app.post('/campaign-versions/:id/submit', async (request, reply) => {
    const id = parseId(request.params); const body = campaignApprovalSchema.pick({ actor: true }).safeParse(request.body); const key = idempotencyKey(request.headers);
    if (!id.success || !body.success || !key.success) return reply.status(400).send({ error: 'Invalid version submission', code: 'INVALID_REQUEST' });
    return campaignRoute(reply, async () => (await transitionCampaignVersion(db, { campaignVersionId: id.data, state: 'PENDENTE_APROVACAO', actor: body.data.actor, idempotencyKey: key.data })).data);
  });
  app.post('/campaign-versions/:id/approve', async (request, reply) => {
    const id = parseId(request.params); const body = campaignApprovalSchema.safeParse(request.body); const key = idempotencyKey(request.headers);
    if (!id.success || !body.success || !key.success) return reply.status(400).send({ error: 'Invalid human approval', code: 'INVALID_REQUEST' });
    return campaignRoute(reply, async () => (await transitionCampaignVersion(db, { campaignVersionId: id.data, state: 'APROVADA', actor: body.data.actor, approvedAt: new Date(body.data.approvedAt), idempotencyKey: key.data })).data);
  });
  for (const [action, state] of [['activate', 'ATIVA'], ['pause', 'PAUSADA'], ['resume', 'ATIVA'], ['cancel', 'CANCELADA']] as const) app.post(`/campaigns/:id/${action}`, async (request, reply) => {
    const id = parseId(request.params); const body = campaignStateCommandSchema.safeParse(request.body); const key = idempotencyKey(request.headers);
    if (!id.success || !body.success || !key.success) return reply.status(400).send({ error: `Invalid campaign ${action}`, code: 'INVALID_REQUEST' });
    return campaignRoute(reply, async () => (await transitionCampaign(db, { campaignId: id.data, state, ...body.data, idempotencyKey: key.data })).data);
  });
  app.get('/campaigns/eligible/leads', async (request, reply) => {
    const query = campaignEligibleListSchema.safeParse(request.query); if (!query.success) return reply.status(400).send({ error: 'Invalid eligibility query', code: 'INVALID_REQUEST' });
    const items = await listEligibleCampaignLeads(db, query.data.channel, query.data.pageSize, (query.data.page - 1) * query.data.pageSize);
    return page(items, query.data);
  });
  app.post('/campaigns/:id/simulations', async (request, reply) => {
    const id = parseId(request.params); const body = campaignSimulationSchema.safeParse(request.body); const key = idempotencyKey(request.headers);
    if (!id.success || !body.success || !key.success) return reply.status(400).send({ error: 'Invalid campaign simulation', code: 'INVALID_REQUEST' });
    return campaignRoute(reply, async () => {
      const templates = await listCampaignTemplates(db, body.data.campaignVersionId);
      const template = templates.find((item) => item.channel === body.data.channel);
      if (!template) throw new CampaignPersistenceError('Template not found for channel', 'NOT_FOUND');
      const eligible = await listEligibleCampaignLeads(db, body.data.channel, body.data.pageSize, (body.data.page - 1) * body.data.pageSize);
      const items = [];
      for (const item of eligible) {
        const snapshot = { leadId: item.lead.id, name: item.lead.name ?? '', contact: item.contact.normalizedValue, channel: body.data.channel };
        const recipient = await reserveSimulatedRecipient(db, { campaignId: id.data, campaignVersionId: body.data.campaignVersionId, leadId: item.lead.id, channel: body.data.channel, snapshot, idempotencyKey: `${key.data}:${item.lead.id}` });
        const allowedVariables = template.allowedVariables as string[];
        const values = Object.fromEntries(allowedVariables.map((name) => [name, name === 'name' || name === 'business' ? snapshot.name : name === 'contact' ? snapshot.contact : '']));
        const simulated = simulateCampaignMessage({ channel: body.data.channel, content: template.content, allowedVariables, values });
        const attempt = await createAttemptWithOutbox(db, { recipientId: recipient.data.id, payloadSnapshot: { ...simulated }, idempotencyKey: `${key.data}:${item.lead.id}:attempt` });
        items.push({ recipient: recipient.data, attempt: attempt.data, simulation: simulated });
      }
      return { mode: 'SIMULATION', dispatched: false, items, pagination: { page: body.data.page, pageSize: body.data.pageSize, hasMore: eligible.length === body.data.pageSize } };
    });
  });
  const campaignLists: Array<[string, (id: string, limit: number, offset: number) => Promise<unknown[]>]> = [
    ['/campaigns/:id/recipients', (id: string, limit: number, offset: number) => listCampaignRecipients(db, id, limit, offset)],
    ['/recipients/:id/attempts', (id: string, limit: number, offset: number) => listRecipientAttempts(db, id, limit, offset)],
    ['/campaigns/:id/audit', (id: string, limit: number, offset: number) => listCampaignAudit(db, id, limit, offset)],
    ['/campaign-versions/:id/audit', (id: string, limit: number, offset: number) => listCampaignAudit(db, id, limit, offset)],
  ];
  for (const [url, list] of campaignLists) app.get(url, async (request, reply) => {
    const id = parseId(request.params); const query = campaignListSchema.safeParse(request.query);
    if (!id.success || !query.success) return reply.status(400).send({ error: 'Invalid campaign query', code: 'INVALID_REQUEST' });
    const items = await list(id.data, query.data.pageSize, (query.data.page - 1) * query.data.pageSize); return page(items, query.data);
  });
  app.get('/campaigns/failures', async (request, reply) => {
    const query = campaignListSchema.safeParse(request.query); if (!query.success) return reply.status(400).send({ error: 'Invalid failure query', code: 'INVALID_REQUEST' });
    return page(await listCampaignFailures(db, query.data.pageSize, (query.data.page - 1) * query.data.pageSize), query.data);
  });
  app.post('/collect', async (request, reply) => {
    const parsed = collectSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: 'Invalid collection parameters', details: parsed.error.flatten() });
    if (parsed.data.limit > dailyLeadLimit)
      return reply.status(400).send({
        error: 'Invalid collection parameters',
        details: { fieldErrors: { limit: [`Limit exceeds DAILY_LEAD_LIMIT (${dailyLeadLimit})`] } },
      });
    const job = await enqueueCollection(db, parsed.data);
    return reply.status(202).send(job);
  });
  app.get('/leads/export.csv', async (request, reply) => {
    const query = typeof request.query === 'object' && request.query !== null ? request.query : {};
    const parsed = listLeadsSchema.safeParse({ ...query, page: 1, pageSize: 100 });
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query' });
    const result = await listLeads(db, parsed.data);
    const fields = [
      'id',
      'name',
      'category',
      'phone',
      'whatsapp',
      'email',
      'instagram',
      'facebook',
      'address',
      'city',
      'state',
      'score',
      'status',
      'osmType',
      'osmId',
    ] as const;
    const csv = [
      fields.join(','),
      ...result.items.map((row) => fields.map((field) => csvCell(row[field])).join(',')),
    ].join('\n');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="leads.csv"')
      .send(csv);
  });
  return app;
}
