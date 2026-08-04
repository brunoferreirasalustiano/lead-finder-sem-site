import { sql } from 'drizzle-orm';
import type { Database } from './index.js';
import {
  assertMonotonicCityTransition,
  buildProspectingCityRunMetrics,
  calculateCitySaturation,
  evaluateCityTransition,
  getNextProspectingCity,
  normalizeProspectingRejectionReasons,
  prospectingCities,
  prospectingRejectionReasons,
  type ProspectingCity,
  type ProspectingCityRunMetrics,
  type ProspectingCityRunMetricsInput,
  type ProspectingRejectionReason,
  type RejectionReasonCounts,
} from '@lead-finder/prospecting-orchestrator';

export const DEFAULT_PROSPECTING_CAMPAIGN_KEY = 'lead-finder-default';

type RunRow = {
  id: string;
  execution_fingerprint: string;
  campaign_key: string;
  city: ProspectingCity;
  started_at: Date | string;
  completed_at: Date | string | null;
  found: number;
  approved: number;
  rejected: number;
  sent_accepted_by_provider: number;
  immediate_bounces: number;
  opt_outs: number;
  replies: number;
  complaints: number;
  blocked: number;
  duplicates_avoided: number;
  score_0_59: number;
  score_60_79: number;
  score_80_99: number;
  score_100: number;
  approval_rate: number | string | null;
  rejection_rate: number | string | null;
  send_rate_among_approved: number | string | null;
  created_at: Date | string;
};

type ReasonRow = { reason: ProspectingRejectionReason; count: number };
type CityStateRow = {
  campaign_key: string;
  current_city: ProspectingCity;
  consecutive_low_yield_runs: number;
  version: number;
  updated_at: Date | string;
};
type RecentRunRow = { id: string; found: number; approved: number; rejected: number; created_at: Date | string; rejection_reasons: unknown };
type SqlExecutor = Pick<Database, 'execute'>;

export type ProspectingRun = ProspectingCityRunMetrics & Readonly<{
  id: string;
  executionFingerprint: string;
  campaignKey: string;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}>;

export type ProspectingCityState = Readonly<{
  campaignKey: string;
  currentCity: ProspectingCity;
  consecutiveLowYieldRuns: number;
  version: number;
  updatedAt: Date;
}>;

export type ProspectingCityTransition = Readonly<{
  id: string;
  campaignKey: string;
  fromCity: ProspectingCity;
  toCity: ProspectingCity;
  reason: string;
  triggeringRunId: string;
  createdAt: Date;
}>;

export type ProspectingRunCreateResult = Readonly<{
  run: ProspectingRun;
  replayed: boolean;
  state: ProspectingCityState;
  transition: ProspectingCityTransition | null;
}>;

export type ProspectingCitySnapshot = Readonly<{
  currentCity: ProspectingCity;
  nextCity: ProspectingCity | null;
  cities: readonly Readonly<{
    city: ProspectingCity;
    runs: number;
    found: number;
    approved: number;
    rejected: number;
    approvalRate: number;
    saturationIndex: number;
    topRejectionReasons: readonly Readonly<{ reason: ProspectingRejectionReason; count: number }>[];
    status: 'ACTIVE' | 'SATURATING' | 'PENDING' | 'COMPLETE';
  }>[];
}>;

export type CreateProspectingRunInput = Readonly<{
  executionFingerprint: string;
  campaignKey?: string;
  metrics: ProspectingCityRunMetricsInput;
  startedAt?: Date;
  completedAt?: Date;
}>;

export type AdvanceProspectingCityStateInput = Readonly<{
  campaignKey?: string;
  fromCity: ProspectingCity;
  toCity: ProspectingCity;
  reason: string;
  triggeringRunId: string;
  expectedVersion: number;
}>;

const safeKey = (value: string | undefined, field: string, fallback?: string): string => {
  const normalized = (value ?? fallback ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(normalized)) throw new RangeError(`${field} must be a safe identifier`);
  return normalized;
};

const safeFingerprint = (value: string): string => safeKey(value, 'executionFingerprint');
const safeUuid = (value: string, field: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new RangeError(`${field} must be a UUID`);
  }
  return value;
};

const asDate = (value: Date | string): Date => value instanceof Date ? value : new Date(value);

const emptyReasons = (): Record<ProspectingRejectionReason, number> =>
  Object.fromEntries(prospectingRejectionReasons.map((reason) => [reason, 0])) as Record<ProspectingRejectionReason, number>;

const reasonMap = (rows: readonly ReasonRow[]): Record<ProspectingRejectionReason, number> => {
  const result = emptyReasons();
  for (const row of rows) result[row.reason] = Number(row.count);
  return result;
};

const reasonMapFromJson = (value: unknown): RejectionReasonCounts => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: RejectionReasonCounts = {};
  for (const [key, count] of Object.entries(value)) {
    if ((prospectingRejectionReasons as readonly string[]).includes(key) && typeof count === 'number') {
      result[key as ProspectingRejectionReason] = count;
    }
  }
  return result;
};

const toRun = (row: RunRow, rejectionReasons: RejectionReasonCounts): ProspectingRun => {
  const metrics = buildProspectingCityRunMetrics({
    city: row.city,
    found: row.found,
    approved: row.approved,
    rejected: row.rejected,
    sentAcceptedByProvider: row.sent_accepted_by_provider,
    immediateBounces: row.immediate_bounces,
    optOuts: row.opt_outs,
    replies: row.replies,
    complaints: row.complaints,
    blocked: row.blocked,
    duplicatesAvoided: row.duplicates_avoided,
    rejectionReasons,
    scoreDistribution: {
      score0To59: row.score_0_59,
      score60To79: row.score_60_79,
      score80To99: row.score_80_99,
      score100: row.score_100,
    },
  });
  return {
    ...metrics,
    id: row.id,
    executionFingerprint: row.execution_fingerprint,
    campaignKey: row.campaign_key,
    startedAt: asDate(row.started_at),
    completedAt: row.completed_at === null ? null : asDate(row.completed_at),
    createdAt: asDate(row.created_at),
  };
};

const toState = (row: CityStateRow): ProspectingCityState => ({
  campaignKey: row.campaign_key,
  currentCity: row.current_city,
  consecutiveLowYieldRuns: row.consecutive_low_yield_runs,
  version: row.version,
  updatedAt: asDate(row.updated_at),
});

async function reasonsForRun(db: Database, runId: string): Promise<Record<ProspectingRejectionReason, number>> {
  const rows = await db.execute<ReasonRow>(sql`
    SELECT reason, count
    FROM public.prospecting_run_rejection_reasons
    WHERE run_id = ${runId}::uuid
    ORDER BY reason`);
  return reasonMap(rows);
}

async function runById(db: Database, runId: string): Promise<ProspectingRun | null> {
  safeUuid(runId, 'runId');
  const rows = await db.execute<RunRow>(sql`
    SELECT * FROM public.prospecting_runs WHERE id = ${runId}::uuid`);
  const row = rows[0];
  return row ? toRun(row, await reasonsForRun(db, runId)) : null;
}

export async function getProspectingRun(db: Database, runId: string): Promise<ProspectingRun | null> {
  return runById(db, runId);
}

export async function getProspectingRunByFingerprint(db: Database, executionFingerprint: string): Promise<ProspectingRun | null> {
  const fingerprint = safeFingerprint(executionFingerprint);
  const rows = await db.execute<RunRow>(sql`
    SELECT * FROM public.prospecting_runs WHERE execution_fingerprint = ${fingerprint}`);
  const row = rows[0];
  return row ? toRun(row, await reasonsForRun(db, row.id)) : null;
}

export async function saveProspectingRunReasons(
  db: Database,
  runId: string,
  rejectionReasons: RejectionReasonCounts,
): Promise<void> {
  safeUuid(runId, 'runId');
  const normalized = normalizeProspectingRejectionReasons(rejectionReasons);
  await db.transaction(async (tx) => {
    for (const reason of prospectingRejectionReasons) {
      await tx.execute(sql`
        INSERT INTO public.prospecting_run_rejection_reasons (run_id, reason, count)
        VALUES (${runId}::uuid, ${reason}, ${normalized[reason]})
        ON CONFLICT (run_id, reason) DO NOTHING`);
    }
  });
}

export async function getRecentProspectingRunsByCity(
  db: Database,
  city: ProspectingCity,
  campaignKey = DEFAULT_PROSPECTING_CAMPAIGN_KEY,
  limit = 10,
): Promise<readonly ProspectingRun[]> {
  const key = safeKey(campaignKey, 'campaignKey', DEFAULT_PROSPECTING_CAMPAIGN_KEY);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('limit must be between 1 and 100');
  const rows = await db.execute<RunRow>(sql`
    SELECT *
    FROM (
      SELECT * FROM public.prospecting_runs
      WHERE campaign_key = ${key} AND city = ${city}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    ) recent
    ORDER BY created_at ASC, id ASC`);
  return Promise.all(rows.map(async (row) => toRun(row, await reasonsForRun(db, row.id))));
}

export async function getProspectingCityState(db: Database, campaignKey = DEFAULT_PROSPECTING_CAMPAIGN_KEY): Promise<ProspectingCityState | null> {
  const key = safeKey(campaignKey, 'campaignKey', DEFAULT_PROSPECTING_CAMPAIGN_KEY);
  const rows = await db.execute<CityStateRow>(sql`
    SELECT * FROM public.prospecting_city_state WHERE campaign_key = ${key}`);
  return rows[0] ? toState(rows[0]) : null;
}

export async function updateProspectingCityState(db: Database, input: Readonly<{
  campaignKey?: string;
  currentCity: ProspectingCity;
  nextCity?: ProspectingCity;
  consecutiveLowYieldRuns: number;
  expectedVersion: number;
}>): Promise<ProspectingCityState> {
  const key = safeKey(input.campaignKey, 'campaignKey', DEFAULT_PROSPECTING_CAMPAIGN_KEY);
  if (input.nextCity) throw new Error('PROSPECTING_CITY_ADVANCE_REQUIRES_ATOMIC_OPERATION');
  if (!Number.isSafeInteger(input.consecutiveLowYieldRuns) || input.consecutiveLowYieldRuns < 0) throw new RangeError('consecutiveLowYieldRuns must be non-negative');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new RangeError('expectedVersion must be positive');
  const rows = await db.execute<CityStateRow>(sql`
    UPDATE public.prospecting_city_state
    SET consecutive_low_yield_runs = ${input.consecutiveLowYieldRuns},
        version = version + 1, updated_at = clock_timestamp()
    WHERE campaign_key = ${key} AND current_city = ${input.currentCity} AND version = ${input.expectedVersion}
    RETURNING *`);
  if (!rows[0]) throw new Error('PROSPECTING_CITY_STATE_VERSION_CONFLICT');
  return toState(rows[0]);
}

const transitionRowToDomain = (row: {
  id: string; campaign_key: string; from_city: ProspectingCity; to_city: ProspectingCity;
  reason: string; triggering_run_id: string; created_at: Date | string;
}): ProspectingCityTransition => ({
  id: row.id,
  campaignKey: row.campaign_key,
  fromCity: row.from_city,
  toCity: row.to_city,
  reason: row.reason,
  triggeringRunId: row.triggering_run_id,
  createdAt: asDate(row.created_at),
});

async function advanceProspectingCityStateInTransaction(
  tx: SqlExecutor,
  input: AdvanceProspectingCityStateInput,
): Promise<{ state: ProspectingCityState; transition: ProspectingCityTransition }> {
  const key = safeKey(input.campaignKey, 'campaignKey', DEFAULT_PROSPECTING_CAMPAIGN_KEY);
  assertMonotonicCityTransition(input.fromCity, input.toCity);
  safeUuid(input.triggeringRunId, 'triggeringRunId');
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(input.reason)) throw new RangeError('reason must be a safe code');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new RangeError('expectedVersion must be positive');
  const stateRows = await tx.execute<CityStateRow>(sql`
    SELECT * FROM public.prospecting_city_state
    WHERE campaign_key = ${key}
    FOR UPDATE`);
  if (!stateRows[0]) throw new Error('PROSPECTING_CITY_STATE_MISSING');
  if (stateRows[0].current_city !== input.fromCity || stateRows[0].version !== input.expectedVersion) {
    throw new Error('PROSPECTING_CITY_STATE_VERSION_CONFLICT');
  }
  const runRows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM public.prospecting_runs
    WHERE id = ${input.triggeringRunId}::uuid
      AND campaign_key = ${key}
      AND city = ${input.fromCity}`);
  if (!runRows[0]) throw new Error('PROSPECTING_TRIGGERING_RUN_MISMATCH');
  await tx.execute(sql`
    SELECT * FROM public.advance_prospecting_city_state(
      ${key}, ${input.fromCity}, ${input.toCity}, ${input.reason}, ${input.triggeringRunId}::uuid, ${input.expectedVersion}
    )`);
  const updatedRows = await tx.execute<CityStateRow>(sql`
    SELECT * FROM public.prospecting_city_state WHERE campaign_key = ${key}`);
  const transitionRows = await tx.execute<{
    id: string; campaign_key: string; from_city: ProspectingCity; to_city: ProspectingCity;
    reason: string; triggering_run_id: string; created_at: Date | string;
  }>(sql`
    SELECT * FROM public.prospecting_city_transitions
    WHERE campaign_key = ${key} AND from_city = ${input.fromCity}`);
  if (!updatedRows[0] || !transitionRows[0]) throw new Error('PROSPECTING_CITY_ADVANCE_NOT_RECORDED');
  return { state: toState(updatedRows[0]), transition: transitionRowToDomain(transitionRows[0]) };
}

export async function advanceProspectingCityState(
  db: Database,
  input: AdvanceProspectingCityStateInput,
): Promise<{ state: ProspectingCityState; transition: ProspectingCityTransition }> {
  return db.transaction((tx) => advanceProspectingCityStateInTransaction(tx, input));
}

export async function createProspectingRun(db: Database, input: CreateProspectingRunInput): Promise<ProspectingRunCreateResult> {
  const fingerprint = safeFingerprint(input.executionFingerprint);
  const campaignKey = safeKey(input.campaignKey, 'campaignKey', DEFAULT_PROSPECTING_CAMPAIGN_KEY);
  const metrics = buildProspectingCityRunMetrics(input.metrics);
  const startedAt = input.startedAt ?? new Date();
  const completedAt = input.completedAt ?? new Date();
  if (completedAt < startedAt) throw new RangeError('completedAt must not precede startedAt');
  return db.transaction(async (tx) => {
    const existing = await tx.execute<RunRow>(sql`SELECT * FROM public.prospecting_runs WHERE execution_fingerprint = ${fingerprint}`);
    if (existing[0]) {
      if (existing[0].campaign_key !== campaignKey || existing[0].city !== metrics.city) {
        throw new Error('PROSPECTING_RUN_FINGERPRINT_SCOPE_MISMATCH');
      }
      const reasons = await tx.execute<ReasonRow>(sql`SELECT reason, count FROM public.prospecting_run_rejection_reasons WHERE run_id = ${existing[0].id}`);
      const stateRows = await tx.execute<CityStateRow>(sql`SELECT * FROM public.prospecting_city_state WHERE campaign_key = ${campaignKey}`);
      if (!stateRows[0]) throw new Error('PROSPECTING_CITY_STATE_MISSING');
      return { run: toRun(existing[0], reasonMap(reasons)), replayed: true, state: toState(stateRows[0]), transition: null };
    }
    let stateRows = await tx.execute<CityStateRow>(sql`
      SELECT * FROM public.prospecting_city_state WHERE campaign_key = ${campaignKey} FOR UPDATE`);
    if (!stateRows[0]) {
      if (metrics.city !== 'Campinas') throw new Error('PROSPECTING_CAMPAIGN_MUST_START_IN_CAMPINAS');
      await tx.execute(sql`
        INSERT INTO public.prospecting_city_state (campaign_key, current_city, updated_at)
        VALUES (${campaignKey}, 'Campinas', clock_timestamp()) ON CONFLICT (campaign_key) DO NOTHING`);
      stateRows = await tx.execute<CityStateRow>(sql`
        SELECT * FROM public.prospecting_city_state WHERE campaign_key = ${campaignKey} FOR UPDATE`);
    }
    const state = stateRows[0];
    if (!state) throw new Error('PROSPECTING_CITY_STATE_MISSING');
    if (state.current_city !== metrics.city) throw new Error('PROSPECTING_CITY_STATE_MISMATCH');
    const inserted = await tx.execute<RunRow>(sql`
      INSERT INTO public.prospecting_runs (
        execution_fingerprint, campaign_key, city, started_at, completed_at,
        found, approved, rejected, sent_accepted_by_provider, immediate_bounces, opt_outs, replies,
        complaints, blocked, duplicates_avoided, score_0_59, score_60_79, score_80_99, score_100,
        approval_rate, rejection_rate, send_rate_among_approved
      ) VALUES (
        ${fingerprint}, ${campaignKey}, ${metrics.city}, ${startedAt.toISOString()}::timestamptz,
        ${completedAt.toISOString()}::timestamptz, ${metrics.found}, ${metrics.approved}, ${metrics.rejected},
        ${metrics.sentAcceptedByProvider}, ${metrics.immediateBounces}, ${metrics.optOuts}, ${metrics.replies},
        ${metrics.complaints}, ${metrics.blocked}, ${metrics.duplicatesAvoided}, ${metrics.scoreDistribution.score0To59},
        ${metrics.scoreDistribution.score60To79}, ${metrics.scoreDistribution.score80To99}, ${metrics.scoreDistribution.score100},
        ${metrics.approvalRate}, ${metrics.rejectionRate}, ${metrics.sendRateAmongApproved}
      ) ON CONFLICT (execution_fingerprint) DO NOTHING RETURNING *`);
    if (!inserted[0]) {
      const replay = await tx.execute<RunRow>(sql`SELECT * FROM public.prospecting_runs WHERE execution_fingerprint = ${fingerprint}`);
      if (!replay[0]) throw new Error('PROSPECTING_RUN_REPLAY_NOT_FOUND');
      if (replay[0].campaign_key !== campaignKey || replay[0].city !== metrics.city) {
        throw new Error('PROSPECTING_RUN_FINGERPRINT_SCOPE_MISMATCH');
      }
      const reasons = await tx.execute<ReasonRow>(sql`SELECT reason, count FROM public.prospecting_run_rejection_reasons WHERE run_id = ${replay[0].id}`);
      return { run: toRun(replay[0], reasonMap(reasons)), replayed: true, state: toState(state), transition: null };
    }
    for (const reason of prospectingRejectionReasons) {
      await tx.execute(sql`
        INSERT INTO public.prospecting_run_rejection_reasons (run_id, reason, count)
        VALUES (${inserted[0].id}::uuid, ${reason}, ${metrics.rejectionReasons[reason]})`);
    }
    const recentRows = await tx.execute<RecentRunRow>(sql`
      SELECT recent.id, recent.found, recent.approved, recent.rejected, recent.created_at,
        coalesce(jsonb_object_agg(reasons.reason, reasons.count) FILTER (WHERE reasons.reason IS NOT NULL), '{}'::jsonb) AS rejection_reasons
      FROM (
        SELECT id, found, approved, rejected, created_at
        FROM public.prospecting_runs
        WHERE campaign_key = ${campaignKey} AND city = ${metrics.city}
        ORDER BY created_at DESC, id DESC
        LIMIT 2
      ) recent
      LEFT JOIN public.prospecting_run_rejection_reasons reasons ON reasons.run_id = recent.id
      GROUP BY recent.id, recent.found, recent.approved, recent.rejected, recent.created_at
      ORDER BY recent.created_at ASC, recent.id ASC`);
    const decision = evaluateCityTransition({
      currentCity: metrics.city,
      recentRuns: recentRows.map((row) => ({ found: row.found, approved: row.approved, rejected: row.rejected, rejectionReasons: reasonMapFromJson(row.rejection_reasons) })),
    });
    let transition: ProspectingCityTransition | null = null;
    let updated: ProspectingCityState;
    if (decision.action === 'ADVANCE' && decision.nextCity) {
      const advanced = await advanceProspectingCityStateInTransaction(tx, {
        campaignKey,
        fromCity: metrics.city,
        toCity: decision.nextCity,
        reason: decision.reasonCodes[0] ?? 'CITY_ADVANCED',
        triggeringRunId: inserted[0].id,
        expectedVersion: state.version,
      });
      updated = advanced.state;
      transition = advanced.transition;
    } else {
      const progressed = await tx.execute<CityStateRow>(sql`
        UPDATE public.prospecting_city_state
        SET consecutive_low_yield_runs = ${decision.consecutiveLowYieldRuns},
            version = version + 1, updated_at = clock_timestamp()
        WHERE campaign_key = ${campaignKey} AND current_city = ${state.current_city} AND version = ${state.version}
        RETURNING *`);
      if (!progressed[0]) throw new Error('PROSPECTING_CITY_STATE_VERSION_CONFLICT');
      updated = toState(progressed[0]);
    }
    return { run: toRun(inserted[0], metrics.rejectionReasons), replayed: false, state: updated, transition };
  });
}

export async function getProspectingCityMetricsSnapshot(
  db: Database,
  campaignKey = DEFAULT_PROSPECTING_CAMPAIGN_KEY,
): Promise<ProspectingCitySnapshot> {
  const key = safeKey(campaignKey, 'campaignKey', DEFAULT_PROSPECTING_CAMPAIGN_KEY);
  const stateRows = await db.execute<CityStateRow>(sql`SELECT * FROM public.prospecting_city_state WHERE campaign_key = ${key}`);
  const state = stateRows[0];
  const currentCity = state?.current_city ?? 'Campinas';
  const cityRows = await db.execute<{
    city: ProspectingCity; runs: number; found: number; approved: number; rejected: number;
  }>(sql`
    SELECT city, count(*)::int AS runs, coalesce(sum(found), 0)::int AS found,
      coalesce(sum(approved), 0)::int AS approved, coalesce(sum(rejected), 0)::int AS rejected
    FROM public.prospecting_runs WHERE campaign_key = ${key} GROUP BY city`);
  const reasonRows = await db.execute<{ city: ProspectingCity; reason: ProspectingRejectionReason; count: number }>(sql`
    SELECT runs.city, reasons.reason, sum(reasons.count)::int AS count
    FROM public.prospecting_runs runs
    JOIN public.prospecting_run_rejection_reasons reasons ON reasons.run_id = runs.id
    WHERE runs.campaign_key = ${key}
    GROUP BY runs.city, reasons.reason`);
  const currentIndex = prospectingCities.indexOf(currentCity);
  const cities = prospectingCities.map((city) => {
    const totals = cityRows.find((row) => row.city === city);
    const reasons = reasonMap(reasonRows.filter((row) => row.city === city));
    const saturation = calculateCitySaturation({
      city, found: totals?.found ?? 0, approved: totals?.approved ?? 0, rejected: totals?.rejected ?? 0, rejectionReasons: reasons,
      consecutiveLowYieldRuns: city === currentCity ? state?.consecutive_low_yield_runs ?? 0 : 0,
    });
    const cityIndex = prospectingCities.indexOf(city);
    const status: ProspectingCitySnapshot['cities'][number]['status'] = cityIndex < currentIndex
      ? 'COMPLETE' : city === currentCity ? saturation.saturationIndex >= 70 ? 'SATURATING' : 'ACTIVE' : 'PENDING';
    const topRejectionReasons = Object.entries(reasons)
      .filter(([, count]) => count > 0)
      .sort(([reasonA, countA], [reasonB, countB]) => countB - countA || reasonA.localeCompare(reasonB))
      .slice(0, 3)
      .map(([reason, count]) => ({ reason: reason as ProspectingRejectionReason, count }));
    return {
      city, runs: totals?.runs ?? 0, found: totals?.found ?? 0, approved: totals?.approved ?? 0,
      rejected: totals?.rejected ?? 0, approvalRate: (totals?.found ?? 0) === 0 ? 0 : (totals?.approved ?? 0) / totals!.found,
      saturationIndex: saturation.saturationIndex, topRejectionReasons, status,
    };
  });
  return { currentCity, nextCity: getNextProspectingCity(currentCity), cities };
}

export const getRecentRuns = getRecentProspectingRunsByCity;
export const getCityState = getProspectingCityState;
export const updateCityState = updateProspectingCityState;
export const advanceCityState = advanceProspectingCityState;
export const buildCitySnapshot = getProspectingCityMetricsSnapshot;
