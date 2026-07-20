import postgres from 'postgres';

const url = process.env['VERIFY_DATABASE_URL'];
if (!url) throw new Error('VERIFY_DATABASE_URL is required');
const sql = postgres(url, { max: 1, connect_timeout: 10 });
try {
  const migrations = await sql<{ version: string }[]>`select version from schema_migrations order by version`;
  const required = ['0012_pilot_referential_integrity', '0013_dual_deployment_processing', '0014_batch_invocation_recovery'];
  for (const version of required) if (!migrations.some((row) => row.version === version)) throw new Error(`missing migration ${version}`);
  const integrity = await sql<{ invalid: number }[]>`
    select (select count(*)::int from deployment_daily_lead_counters where count < 0 or count > 60)
      + (select count(*)::int from processor_leadership where lease_expires_at <= updated_at) as invalid`;
  if (integrity[0]?.invalid !== 0) throw new Error('database integrity verification failed');
  console.log(JSON.stringify({ status: 'ok', migrations: migrations.length }));
} finally { await sql.end(); }
