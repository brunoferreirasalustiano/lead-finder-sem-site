import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const sql = postgres(url, { max: 1 });
try {
  await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
  const version = '0001_initial';
  const applied = await sql`select version from schema_migrations where version = ${version}`;
  if (applied.length === 0) {
    const migration = await readFile(
      new URL('../database/migrations/0001_initial.sql', import.meta.url),
      'utf8',
    );
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`insert into schema_migrations (version) values (${version})`;
    });
    console.log(`Migration ${version} applied`);
  } else {
    console.log(`Migration ${version} already applied`);
  }
} finally {
  await sql.end();
}
