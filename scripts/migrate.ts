import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { getMigrationSource } from './migration-registry-plan.js';
import {
  assertKnownMigrationOnlyVersion,
  buildMigrationRunPlan,
  parseMigrationOnlyVersion,
} from './migration-run-plan.js';
import { assertImportedMigrationParity, loadMigrationRegistry } from './migration-registry.js';
import { prepareMigrationSqlForRunner } from './migration-sql.js';

const directory = new URL('../database/migrations/', import.meta.url);
const allFiles = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
const allVersions = allFiles.map((file) => file.replace(/\.sql$/, ''));
const onlyVersion = parseMigrationOnlyVersion(process.env['MIGRATION_ONLY_VERSION']);
assertKnownMigrationOnlyVersion(allVersions, onlyVersion);

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const sql = postgres(url, { max: 1 });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

  const registry = await loadMigrationRegistry(sql);
  const selectedVersions = buildMigrationRunPlan(
    allVersions,
    (version) => getMigrationSource(registry, version),
    onlyVersion,
  );
  const selectedVersionSet = new Set(selectedVersions);
  const files = allFiles.filter((file) => selectedVersionSet.has(file.replace(/\.sql$/, '')));

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const source = getMigrationSource(registry, version);

    if (source !== 'PENDING') {
      await assertImportedMigrationParity(sql, version, source);
      console.log(`Migration ${version} already applied (source=${source})`);
      continue;
    }

    const migration = prepareMigrationSqlForRunner(
      await readFile(new URL(file, directory), 'utf8'),
    );
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`INSERT INTO public.schema_migrations (version) VALUES (${version})`;
    });
    registry.local.add(version);
    console.log(`Migration ${version} applied (source=LOCAL)`);
  }
} finally {
  await sql.end();
}
