import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const sql = postgres(url, { max: 1 });
try {
  await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
  const directory = new URL('../database/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const version = file.replace(/\.sql$/, '');
    const applied = await sql`select version from schema_migrations where version = ${version}`;
    if (applied.length === 0) {
      const migration = await readFile(new URL(file, directory), 'utf8');
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`insert into schema_migrations (version) values (${version})`;
      });
      console.log(`Migration ${version} applied`);
    } else {
      console.log(`Migration ${version} already applied`);
    }
  }
} finally {
  await sql.end();
}
