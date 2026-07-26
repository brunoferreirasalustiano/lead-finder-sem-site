import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  confirmOperatorTestResult,
  OperatorChannelTestError,
  prepareOperatorWhatsAppTest,
  recordOperatorTestOpen,
  recordOperatorTestResponse,
  type Database,
  type OperatorTestRuntime,
} from '@lead-finder/database';
import { authorizationContextFor } from './auth.js';

const preparationIdSchema = z.string().uuid();
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const prepareSchema = z.object({
  templateId: z.literal('operator-whatsapp-channel-test'),
  templateVersion: z.literal('v1'),
}).strict();
const confirmationSchema = z.object({
  result: z.enum(['SENT_CONFIRMED', 'NOT_SENT', 'OPERATIONAL_ERROR']),
}).strict();
const responseSchema = z.object({
  result: z.enum(['RECEIVED_CONFIRMED', 'NOT_RECEIVED', 'READ_CONFIRMED']),
}).strict();
const emptySchema = z.object({}).strict();

type OperatorTestOperations = Readonly<{
  prepare: typeof prepareOperatorWhatsAppTest;
  open: typeof recordOperatorTestOpen;
  confirm: typeof confirmOperatorTestResult;
  response: typeof recordOperatorTestResponse;
}>;

const defaultOperations: OperatorTestOperations = {
  prepare: prepareOperatorWhatsAppTest,
  open: recordOperatorTestOpen,
  confirm: confirmOperatorTestResult,
  response: recordOperatorTestResponse,
};

const idempotencyKeyFor = (request: FastifyRequest) => {
  const value = request.headers['idempotency-key'];
  return idempotencyKeySchema.safeParse(typeof value === 'string' ? value : undefined);
};

const preparationIdFor = (request: FastifyRequest) =>
  preparationIdSchema.safeParse((request.params as { id?: unknown }).id);

const operatorTestError = (error: unknown, reply: FastifyReply) => {
  if (!(error instanceof OperatorChannelTestError)) throw error;
  const status = error.code === 'NOT_FOUND' ? 404
    : error.code === 'FORBIDDEN' ? 403
      : error.code === 'DISABLED' || error.code === 'KILL_SWITCH_ENGAGED'
        || error.code === 'INVALID_RECIPIENT' || error.code === 'INVALID_FINGERPRINT_KEY' ? 503
        : 409;
  return reply.status(status).send({ error: 'Operator test operation failed', code: error.code });
};

const execute = async <T>(reply: FastifyReply, operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error) {
    return operatorTestError(error, reply);
  }
};

export function registerOperatorTestRoutes(
  app: FastifyInstance,
  db: Database,
  runtime: OperatorTestRuntime,
  overrides: Partial<OperatorTestOperations> = {},
) {
  const operations: OperatorTestOperations = {
    prepare: overrides.prepare ?? defaultOperations.prepare,
    open: overrides.open ?? defaultOperations.open,
    confirm: overrides.confirm ?? defaultOperations.confirm,
    response: overrides.response ?? defaultOperations.response,
  };

  app.post('/operator-tests/whatsapp/preparations', async (request, reply) => {
    const body = prepareSchema.safeParse(request.body);
    const idempotencyKey = idempotencyKeyFor(request);
    if (!body.success || !idempotencyKey.success) {
      return reply.status(400).send({ error: 'Invalid request', code: 'INVALID_OPERATOR_TEST_REQUEST' });
    }
    return execute(reply, async () => {
      const result = await operations.prepare(
        db,
        { ...body.data, idempotencyKey: idempotencyKey.data },
        authorizationContextFor(request),
        runtime,
      );
      return reply.status(result.replayed ? 200 : 201).send({
        preparationId: result.preparationId,
        state: result.state,
        purpose: result.purpose,
        channel: result.channel,
        templateId: result.templateId,
        templateVersion: result.templateVersion,
        preparedAt: result.preparedAt,
        replayed: result.replayed,
      });
    });
  });

  app.post('/operator-test-preparations/:id/open', async (request, reply) => {
    const preparationId = preparationIdFor(request);
    const body = emptySchema.safeParse(request.body ?? {});
    const idempotencyKey = idempotencyKeyFor(request);
    if (!preparationId.success || !body.success || !idempotencyKey.success) {
      return reply.status(400).send({ error: 'Invalid request', code: 'INVALID_OPERATOR_TEST_REQUEST' });
    }
    return execute(reply, () => operations.open(
      db,
      preparationId.data,
      { idempotencyKey: idempotencyKey.data },
      authorizationContextFor(request),
      runtime,
    ));
  });

  app.post('/operator-test-preparations/:id/confirm', async (request, reply) => {
    const preparationId = preparationIdFor(request);
    const body = confirmationSchema.safeParse(request.body);
    const idempotencyKey = idempotencyKeyFor(request);
    if (!preparationId.success || !body.success || !idempotencyKey.success) {
      return reply.status(400).send({ error: 'Invalid request', code: 'INVALID_OPERATOR_TEST_REQUEST' });
    }
    return execute(reply, () => operations.confirm(
      db,
      preparationId.data,
      { result: body.data.result, idempotencyKey: idempotencyKey.data },
      authorizationContextFor(request),
      runtime,
    ));
  });

  app.post('/operator-test-preparations/:id/response', async (request, reply) => {
    const preparationId = preparationIdFor(request);
    const body = responseSchema.safeParse(request.body);
    const idempotencyKey = idempotencyKeyFor(request);
    if (!preparationId.success || !body.success || !idempotencyKey.success) {
      return reply.status(400).send({ error: 'Invalid request', code: 'INVALID_OPERATOR_TEST_REQUEST' });
    }
    return execute(reply, () => operations.response(
      db,
      preparationId.data,
      { result: body.data.result, idempotencyKey: idempotencyKey.data },
      authorizationContextFor(request),
      runtime,
    ));
  });
}
