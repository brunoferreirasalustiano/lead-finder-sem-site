import { createDatabase } from '@lead-finder/database';
import { parseApiConfig } from '@lead-finder/shared';
import { buildApp } from './app.js';
const config = parseApiConfig(process.env);
const { db, close } = createDatabase(config.DATABASE_URL);
const app = buildApp(db, { dailyLeadLimit: config.DAILY_LEAD_LIMIT });
let shutdownPromise: Promise<void> | undefined;
const shutdown = (exitCode = 0) => {
  process.exitCode = exitCode;
  shutdownPromise ??= (async () => {
    await app.close();
    await close();
  })();
  return shutdownPromise;
};
const fatal = (kind: string, error: unknown) => {
  app.log.fatal({ err: error }, kind);
  void shutdown(1);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('unhandledRejection', (error) => fatal('Unhandled rejection', error));
process.on('uncaughtException', (error) => fatal('Uncaught exception', error));
try {
  await app.listen({ host: '0.0.0.0', port: config.API_PORT });
} catch (error) {
  fatal('API startup failed', error);
  await shutdownPromise;
}
