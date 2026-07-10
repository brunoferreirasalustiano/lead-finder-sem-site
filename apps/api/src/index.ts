import { createDatabase } from '@lead-finder/database';
import { buildApp } from './app.js';
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const port = Number(process.env['API_PORT'] ?? 3000);
const { db, close } = createDatabase(databaseUrl);
const app = buildApp(db);
const shutdown = async () => {
  await app.close();
  await close();
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
await app.listen({ host: '0.0.0.0', port });
