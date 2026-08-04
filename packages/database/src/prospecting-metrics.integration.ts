import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import {
  createDatabase,
  createProspectingRun,
  getProspectingCityMetricsSnapshot,
  getProspectingCityState,
  getProspectingRunByFingerprint,
  updateProspectingCityState,
} from './index.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const { db, close } = createDatabase(databaseUrl, { max: 4 });
const suffix = `${process.pid}-${Date.now()}`;
const campaignKey = `synthetic-metrics-${suffix}`;
const metrics = (city: 'Campinas' | 'Valinhos') => ({
  city,
  found: 10,
  approved: 1,
  rejected: 9,
  sentAcceptedByProvider: 0,
  immediateBounces: 0,
  optOuts: 0,
  replies: 0,
  complaints: 0,
  blocked: 0,
  duplicatesAvoided: 0,
  rejectionReasons: { OFFICIAL_SITE: 5, BUSINESS_EMAIL_NOT_FOUND: 4 },
  scoreDistribution: { score0To59: 10, score60To79: 0, score80To99: 0, score100: 0 },
});

try {
  const migration = await db.execute<{ version: string }>(sql`
    SELECT version FROM public.schema_migrations WHERE version = '0027_prospecting_city_metrics'`);
  assert.equal(migration.length, 1, '0027 migration must be applied before integration tests');

  const firstFingerprint = `synthetic-${suffix}-one`;
  const first = await createProspectingRun(db, { executionFingerprint: firstFingerprint, campaignKey, metrics: metrics('Campinas') });
  assert.equal(first.replayed, false);
  assert.equal(first.state.currentCity, 'Campinas');
  const replay = await createProspectingRun(db, { executionFingerprint: firstFingerprint, campaignKey, metrics: metrics('Campinas') });
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.id, first.run.id);

  const second = await createProspectingRun(db, { executionFingerprint: `synthetic-${suffix}-two`, campaignKey, metrics: metrics('Campinas') });
  assert.equal(second.transition?.fromCity, 'Campinas');
  assert.equal(second.transition?.toCity, 'Valinhos');
  assert.equal(second.state.currentCity, 'Valinhos');

  const concurrentFingerprint = `synthetic-${suffix}-concurrent`;
  const concurrent = await Promise.all([
    createProspectingRun(db, { executionFingerprint: concurrentFingerprint, campaignKey, metrics: metrics('Valinhos') }),
    createProspectingRun(db, { executionFingerprint: concurrentFingerprint, campaignKey, metrics: metrics('Valinhos') }),
  ]);
  assert.equal(concurrent.filter((result) => !result.replayed).length, 1);
  assert.equal(concurrent.filter((result) => result.replayed).length, 1);
  assert.equal((await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM public.prospecting_runs WHERE execution_fingerprint = ${concurrentFingerprint}`))[0]?.count, 1);

  const state = await getProspectingCityState(db, campaignKey);
  assert.equal(state?.currentCity, 'Valinhos');
  await assert.rejects(
    updateProspectingCityState(db, {
      campaignKey, currentCity: 'Valinhos', consecutiveLowYieldRuns: 0,
      expectedVersion: (state?.version ?? 1) - 1,
    }),
    /VERSION_CONFLICT/,
  );
  await assert.rejects(
    db.execute(sql`INSERT INTO public.prospecting_run_rejection_reasons (run_id, reason, count)
      VALUES ('00000000-0000-4000-8000-000000000000'::uuid, 'DUPLICATE', 1)`),
    (error: unknown) => {
      const cause = typeof error === 'object' && error !== null && 'cause' in error ? String(error.cause) : '';
      return /foreign key|violates foreign key/i.test(`${String(error)}\n${cause}`);
    },
  );
  await assert.rejects(
    db.execute(sql`INSERT INTO public.prospecting_runs (execution_fingerprint, campaign_key, city, found, approved,
      rejected, score_0_59, score_60_79, score_80_99, score_100)
      VALUES (${`synthetic-${suffix}-invalid`}, ${campaignKey}, 'Valinhos', 1, 2, 0, 1, 0, 0, 0)`),
    (error: unknown) => {
      const cause = typeof error === 'object' && error !== null && 'cause' in error ? String(error.cause) : '';
      return /check constraint|violates check constraint/i.test(`${String(error)}\n${cause}`);
    },
  );
  await assert.rejects(
    db.execute(sql`INSERT INTO public.prospecting_city_transitions (campaign_key, from_city, to_city, reason)
      VALUES (${campaignKey}, 'Campinas', 'Hortolândia', 'SKIP')`),
    (error: unknown) => {
      const cause = typeof error === 'object' && error !== null && 'cause' in error ? String(error.cause) : '';
      return /must advance exactly one/i.test(`${String(error)}\n${cause}`);
    },
  );
  const snapshot = await getProspectingCityMetricsSnapshot(db, campaignKey);
  assert.equal(snapshot.currentCity, 'Valinhos');
  assert.equal(snapshot.cities.length, 6);
  assert.doesNotMatch(JSON.stringify(snapshot), /phone|@|message content|bearer|token|wa\.me/i);

  await assert.rejects(
    db.execute(sql`UPDATE public.prospecting_runs SET approved = 0 WHERE id = ${first.run.id}::uuid`),
    (error: unknown) => {
      const cause = typeof error === 'object' && error !== null && 'cause' in error ? String(error.cause) : '';
      return /append-only/i.test(`${String(error)}\n${cause}`);
    },
  );
  assert.equal((await getProspectingRunByFingerprint(db, firstFingerprint))?.approved, 1);

  console.log('prospecting_metrics_integration_passed', { campaignKey, runs: 3, transitions: 1 });
} finally {
  await close();
}
