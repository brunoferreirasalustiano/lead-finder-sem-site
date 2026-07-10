import Fastify from 'fastify';
import {
  checkDatabase,
  enqueueCollection,
  getLead,
  listLeads,
  type Database,
} from '@lead-finder/database';
import { collectSchema, listLeadsSchema } from '@lead-finder/shared';
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
