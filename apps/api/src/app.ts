import Fastify from 'fastify';
import {
  checkDatabase,
  enqueueCollection,
  getLead,
  listLeads,
  addEvidence,
  getQualification,
  listContacts,
  listEvidence,
  listHistory,
  QualificationError,
  updateQualification,
  upsertContact,
  type Database,
} from '@lead-finder/database';
import {
  collectSchema,
  contactInputSchema,
  evidenceInputSchema,
  listLeadsSchema,
  qualificationUpdateSchema,
} from '@lead-finder/shared';
import { z } from 'zod';

const idSchema = z.string().uuid();
export const csvCell = (value: string | number | boolean | Date | null | undefined) => {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? '');
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};
export function buildApp(db: Database, options: { dailyLeadLimit?: number } = {}) {
  const dailyLeadLimit = options.dailyLeadLimit ?? 50;
  const app = Fastify({ logger: true, bodyLimit: 16_384, requestTimeout: 15_000 });
  app.get('/health/live', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  const ready = async (
    _request: unknown,
    reply: { status: (code: number) => { send: (body: object) => unknown } },
  ) => {
    try {
      await checkDatabase(db);
      return { status: 'ready', timestamp: new Date().toISOString() };
    } catch {
      return reply.status(503).send({ error: 'Service unavailable', code: 'DATABASE_UNAVAILABLE' });
    }
  };
  app.get('/health', ready);
  app.get('/health/ready', ready);
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
