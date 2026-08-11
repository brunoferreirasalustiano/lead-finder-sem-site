import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { createDatabase, runHmlSuppressionProbe } from '@lead-finder/database';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const database = createDatabase(databaseUrl, { max: 4, ssl: process.env.DATABASE_SSL_MODE as 'disable' | 'require' | 'verify-full' | undefined });
const auth = {
  principalId: 'hml-suppression-probe-ci',
  permissions: new Set(['hml-suppression-probe:run']),
  authenticationMethod: 'CI',
} as const;

try {
  const before = await database.db.execute<{ count: number }>(
    sql`select count(*)::int as count from public.email_precontact_delivery_suppressions`,
  );
  const results = await Promise.all([
    runHmlSuppressionProbe(database.db, auth),
    runHmlSuppressionProbe(database.db, auth),
  ]);
  for (const result of results) {
    assert.equal(result.status, 'PASS');
    assert.equal(result.suppressionMatched, true);
    assert.equal(result.sendEligible, false);
    assert.equal(result.providerCalls, 0);
    assert.equal(result.fixtureRolledBack, true);
    assert.equal(result.fixtureRowsRemaining, 0);
  }
  await assert.rejects(
    runHmlSuppressionProbe(database.db, auth, { injectFailureAfterFixture: true }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
      return message.includes('HML_SUPPRESSION_PROBE_INJECTED_FAILURE')
        || cause.includes('HML_SUPPRESSION_PROBE_INJECTED_FAILURE');
    },
  );
  const after = await database.db.execute<{ count: number }>(
    sql`select count(*)::int as count from public.email_precontact_delivery_suppressions`,
  );
  assert.equal(Number(after[0]?.count ?? 0), Number(before[0]?.count ?? 0));
  process.stdout.write(JSON.stringify({
    gate: 'HOSTED_SUPPRESSION_PROBE',
    result: 'PASS',
    suppressionMatch: true,
    sendEligible: false,
    providerCalls: 0,
    fixtureRolledBack: true,
    fixtureRowsRemaining: 0,
    concurrentProbes: 2,
  }) + '\n');
} finally {
  await database.close();
}
