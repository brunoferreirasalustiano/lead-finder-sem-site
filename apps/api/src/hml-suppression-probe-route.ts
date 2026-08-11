import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runHmlSuppressionProbe, type Database } from '@lead-finder/database';
import { authorizationContextFor } from './auth.js';

const emptyBody = z.object({}).strict();

export function registerHmlSuppressionProbeRoute(
  app: FastifyInstance,
  db: Database,
  options: Readonly<{
    enabled: boolean;
    deploymentEnvironment: 'development' | 'homologation' | 'production';
    probe?: typeof runHmlSuppressionProbe;
  }>,
) {
  const probe = options.probe ?? runHmlSuppressionProbe;
  let probeConsumed = false;
  let probeInFlight: Promise<Awaited<ReturnType<typeof probe>>> | undefined;
  app.post('/internal/hml/suppression-probe', async (request, reply) => {
    if (!options.enabled || options.deploymentEnvironment !== 'homologation') {
      return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
    }
    if (!emptyBody.safeParse(request.body).success) {
      return reply.status(400).send({ error: 'Invalid request', code: 'INVALID_REQUEST' });
    }
    if (probeConsumed) {
      return reply.status(409).send({
        error: 'Probe already consumed',
        code: 'HML_SUPPRESSION_PROBE_ALREADY_USED',
      });
    }
    if (probeInFlight) {
      return reply.status(429).send({
        error: 'Probe busy',
        code: 'HML_SUPPRESSION_PROBE_RATE_LIMITED',
      });
    }
    probeInFlight = probe(db, authorizationContextFor(request));
    try {
      const result = await probeInFlight;
      probeConsumed = true;
      return result;
    } catch {
      request.log.error({ event: 'hml_suppression_probe_failed', code: 'HML_SUPPRESSION_PROBE_FAILED' }, 'hml_suppression_probe_failed');
      return reply.status(503).send({ error: 'Suppression probe unavailable', code: 'HML_SUPPRESSION_PROBE_FAILED' });
    } finally {
      probeInFlight = undefined;
    }
  });
}
