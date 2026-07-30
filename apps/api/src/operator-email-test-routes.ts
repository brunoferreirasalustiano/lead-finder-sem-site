import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  OperatorEmailTestError,
  sendOperatorEmailTest,
  type Database,
  type OperatorEmailDelivery,
  type OperatorEmailTestRuntime,
} from '@lead-finder/database';
import { authorizationContextFor } from './auth.js';

const bodySchema = z.object({
  templateId: z.literal('operator-email-channel-test'),
  templateVersion: z.literal('v1'),
}).strict();
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

const idempotencyKeyFor = (request: FastifyRequest) => {
  const value = request.headers['idempotency-key'];
  return idempotencyKeySchema.safeParse(typeof value === 'string' ? value : undefined);
};

const operatorEmailError = (error: unknown, reply: FastifyReply) => {
  if (!(error instanceof OperatorEmailTestError)) throw error;
  const status = error.code === 'FORBIDDEN' ? 403
    : error.code === 'IDEMPOTENCY_CONFLICT' || error.code === 'AMBIGUOUS_STATE' ? 409
      : 503;
  return reply.status(status).send({
    error: 'Operator email test failed',
    code: error.code,
  });
};

export function registerOperatorEmailTestRoute(
  app: FastifyInstance,
  db: Database,
  runtime: OperatorEmailTestRuntime,
  deliver: OperatorEmailDelivery,
  operation: typeof sendOperatorEmailTest = sendOperatorEmailTest,
) {
  app.post('/operator-tests/email/send', async (request, reply) => {
    const body = bodySchema.safeParse(request.body);
    const idempotencyKey = idempotencyKeyFor(request);
    if (!body.success || !idempotencyKey.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        code: 'INVALID_OPERATOR_EMAIL_TEST_REQUEST',
      });
    }
    try {
      const result = await operation(
        db,
        { ...body.data, idempotencyKey: idempotencyKey.data },
        authorizationContextFor(request),
        runtime,
        deliver,
      );
      request.log.info({
        event: 'operator_email_test_completed',
        attemptId: result.attemptId,
        state: result.state,
        purpose: result.purpose,
        channel: result.channel,
        templateId: result.templateId,
        templateVersion: result.templateVersion,
        replayed: result.replayed,
      }, 'operator_email_test_completed');
      return reply.status(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      return operatorEmailError(error, reply);
    }
  });
}
