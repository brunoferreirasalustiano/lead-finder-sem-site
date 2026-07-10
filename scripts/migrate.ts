import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const sql = postgres(url, { max: 1 });
try {
  await sql.unsafe(
    await readFile(new URL('../database/migrations/0001_initial.sql', import.meta.url), 'utf8'),
  );
  console.log('Migration applied');
} finally {
  await sql.end();
}
