import postgres from 'postgres';
import { getMigrationSource, listMigrationSources } from '../migration-registry-plan.js';
import { assertImportedMigrationParity, loadMigrationRegistry } from '../migration-registry.js';

const url = process.env['VERIFY_DATABASE_URL'];
if (!url) throw new Error('VERIFY_DATABASE_URL is required');
const sql = postgres(url, { max: 1, connect_timeout: 10 });

try {
  const registry = await loadMigrationRegistry(sql);
  const required = [
    '0012_pilot_referential_integrity',
    '0013_dual_deployment_processing',
    '0014_batch_invocation_recovery',
    '0019_manual_assisted_messaging',
    '0020_manual_messaging_append_only_acl',
  ] as const;

  for (const version of required) {
    const source = getMigrationSource(registry, version);
    if (source === 'PENDING') throw new Error(`missing migration ${version}`);
    await assertImportedMigrationParity(sql, version, source);
  }

  const integrity = await sql<{ invalid: number }[]>`
    SELECT
      (SELECT count(*)::int FROM deployment_daily_lead_counters WHERE count < 0 OR count > 60)
      + (SELECT count(*)::int FROM processor_leadership WHERE lease_expires_at <= updated_at) AS invalid`;
  if (integrity[0]?.invalid !== 0) throw new Error('database integrity verification failed');

  console.log(
    JSON.stringify({
      status: 'ok',
      migrations: new Set([...registry.local, ...registry.supabase.keys()]).size,
      sources: listMigrationSources(registry, required),
    }),
  );
} finally {
  await sql.end();
}
