import { sql } from 'drizzle-orm';
import type { Database } from './index.js';

export const DAILY6_POLICY_VERSION = 'daily6-v1' as const;
export type Daily6TerminalStatus = 'SENT' | 'FAILED' | 'AMBIGUOUS';

export type Daily6ReservationResult = Readonly<{
  reserved: boolean;
  replayed: boolean;
  reason: string;
}>;

export type Daily6FinalizeResult = Readonly<{
  updated: boolean;
  replayed: boolean;
  reason: string;
}>;

const safeResult = (row: Record<string, unknown> | undefined, missing: string): Record<string, unknown> => {
  if (!row) throw new Error(missing);
  return row;
};

export async function reserveDaily6Send(
  db: Database,
  input: Readonly<{
    batchId: string;
    sendIdentity: string;
    leadId: string;
    recipientFingerprint: string;
  }>,
): Promise<Daily6ReservationResult> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select * from lead_finder_internal.reserve_daily6_send(
      ${input.batchId},
      ${input.sendIdentity},
      ${input.leadId}::uuid,
      ${input.recipientFingerprint}::char(64),
      ${DAILY6_POLICY_VERSION}
    )
  `);
  const row = safeResult(rows[0], 'DAILY6_RESERVATION_RESULT_MISSING');
  return {
    reserved: row['reserved'] === true,
    replayed: row['replayed'] === true,
    reason: typeof row['reason'] === 'string' ? row['reason'] : 'UNKNOWN',
  };
}

export async function finalizeDaily6Send(
  db: Database,
  input: Readonly<{
    batchId: string;
    sendIdentity: string;
    status: Daily6TerminalStatus;
    providerMessageFingerprint?: string;
    errorCode?: string;
  }>,
): Promise<Daily6FinalizeResult> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select * from lead_finder_internal.finalize_daily6_send(
      ${input.batchId},
      ${input.sendIdentity},
      ${input.status},
      ${input.providerMessageFingerprint ?? null}::char(64),
      ${input.errorCode ?? null}
    )
  `);
  const row = safeResult(rows[0], 'DAILY6_FINALIZE_RESULT_MISSING');
  return {
    updated: row['updated'] === true,
    replayed: row['replayed'] === true,
    reason: typeof row['reason'] === 'string' ? row['reason'] : 'UNKNOWN',
  };
}
