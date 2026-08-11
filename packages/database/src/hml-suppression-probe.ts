import { sql } from 'drizzle-orm';
import type { AuthorizationContext } from '@lead-finder/shared';
import type { Database } from './index.js';

type HmlSuppressionProbeRow = Readonly<{
  suppression_matched: boolean;
  send_eligible: boolean;
  provider_calls: number;
  fixture_rolled_back: boolean;
  fixture_rows_remaining: number;
}>;

export type HmlSuppressionProbeResult = Readonly<{
  status: 'PASS';
  suppressionMatched: true;
  sendEligible: false;
  providerCalls: 0;
  fixtureRolledBack: true;
  fixtureRowsRemaining: 0;
}>;

const assertProbePermission = (auth: AuthorizationContext) => {
  if (!auth.permissions.has('hml-suppression-probe:run')) {
    throw new Error('HML_SUPPRESSION_PROBE_PERMISSION_REQUIRED');
  }
};

/**
 * Executes the HML-only probe through one SECURITY DEFINER database function.
 * The function owns the transaction and invokes the canonical resolver, so the
 * API runtime does not need direct table or resolver privileges and cannot call
 * a provider as part of this proof.
 */
export async function runHmlSuppressionProbe(
  db: Database,
  auth: AuthorizationContext,
  options: { injectFailureAfterFixture?: boolean } = {},
): Promise<HmlSuppressionProbeResult> {
  assertProbePermission(auth);
  const rows = await db.execute<HmlSuppressionProbeRow>(sql`
    select * from public.run_hml_suppression_probe(
      ${auth.principalId}, ${options.injectFailureAfterFixture ?? false}
    )
  `);
  const row = rows[0];
  if (!row) throw new Error('HML_SUPPRESSION_PROBE_EMPTY_RESULT');
  if (
    row.suppression_matched !== true ||
    row.send_eligible !== false ||
    Number(row.provider_calls) !== 0 ||
    row.fixture_rolled_back !== true ||
    Number(row.fixture_rows_remaining) !== 0
  ) {
    throw new Error('HML_SUPPRESSION_PROBE_INVARIANT_FAILED');
  }
  return {
    status: 'PASS',
    suppressionMatched: true,
    sendEligible: false,
    providerCalls: 0,
    fixtureRolledBack: true,
    fixtureRowsRemaining: 0,
  };
}
