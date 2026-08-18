import type { Database } from '@lead-finder/database';
import { OverpassClient, type OverpassClientOptions } from '@lead-finder/overpass-client';
import type { OperationalLogger } from './operational-observability.js';
import { processNextJob } from './process-job.js';

interface CollectionEgressConfig {
  enabled: boolean;
  endpoint: string | undefined;
  timeoutMs: number;
  maxRetries: number;
  requestIdentity?: string;
}

type ClientFactory = (options: OverpassClientOptions) => OverpassClient;
type JobProcessor = (db: Database, client: OverpassClient, requestIdentity?: string) => Promise<boolean>;
const defaultJobProcessor: JobProcessor = (db, client, requestIdentity) =>
  processNextJob(db, client, undefined, 10, 50, undefined, requestIdentity);

export function createCollectionProcessor(
  db: Database,
  config: CollectionEgressConfig,
  logger: OperationalLogger,
  createClient: ClientFactory = (options) => new OverpassClient(options),
  processJob: JobProcessor = defaultJobProcessor,
): () => Promise<boolean> {
  if (!config.enabled) {
    logger.info({
      correlationId: 'collection-egress',
      event: 'COLLECTION_EGRESS_DISABLED',
      outcome: 'INELIGIBLE',
      reason: 'UNKNOWN',
      durationMs: 0,
    });
    return () => Promise.resolve(false);
  }

  if (!config.endpoint) {
    throw new Error('OVERPASS_API_URL is required when COLLECTION_EGRESS_ENABLED=true');
  }

  const client = createClient({
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
  return config.requestIdentity === undefined
    ? () => processJob(db, client)
    : () => processJob(db, client, config.requestIdentity);
}
