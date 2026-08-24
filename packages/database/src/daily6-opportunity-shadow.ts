import { sql } from 'drizzle-orm';
import type { Database } from './index.js';

export type OpportunityShadowIdentityState = 'CONFIRMED' | 'UNKNOWN' | 'UNCONFIRMED';
export type OpportunityShadowActivityState = 'ACTIVE' | 'UNKNOWN' | 'INACTIVE';
export type OpportunityShadowEmailState = 'PASS' | 'UNKNOWN' | 'MISSING' | 'UNSUITABLE';
export type OpportunityShadowWebsiteState =
  | 'NO_OFFICIAL_SITE_CONFIRMED'
  | 'UNKNOWN'
  | 'OFFICIAL_SITE_FOUND';

export type Daily6OpportunityShadowRow = Readonly<{
  lead_id: string;
  city: string;
  category: string;
  identity_state: OpportunityShadowIdentityState;
  activity_state: OpportunityShadowActivityState;
  email_state: OpportunityShadowEmailState;
  website_state: OpportunityShadowWebsiteState;
  lead_blocked: boolean;
  business_closed: boolean;
  prior_contact: boolean;
  duplicate: boolean;
  pending_or_ambiguous_send: boolean;
  suppressed: boolean;
  hard_bounce: boolean;
  opt_out: boolean;
  do_not_contact: boolean;
  nao_contatar: boolean;
  email_channel_allowed: boolean;
  current_evidence_present: boolean;
  legacy_status_only: boolean;
}>;

type RawRow = Record<string, unknown>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const requiredBoundedText = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string') throw new Error(`${field}_NOT_PROVEN`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) throw new Error(`${field}_NOT_PROVEN`);
  return normalized;
};

const requiredUuid = (value: unknown, field: string): string => {
  const normalized = requiredBoundedText(value, field, 36);
  if (!uuidPattern.test(normalized)) throw new Error(`${field}_NOT_PROVEN`);
  return normalized;
};

const boolValue = (value: unknown, field: string): boolean => {
  if (value === true || value === 't' || value === 'true') return true;
  if (value === false || value === 'f' || value === 'false') return false;
  throw new Error(`${field}_NOT_PROVEN`);
};

const stateValue = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  throw new Error(`${field}_NOT_PROVEN`);
};

const normalizeRow = (row: RawRow): Daily6OpportunityShadowRow => ({
  lead_id: requiredUuid(row.lead_id, 'LEAD_ID'),
  city: requiredBoundedText(row.city, 'CITY', 100),
  category: requiredBoundedText(row.category, 'CATEGORY', 100),
  identity_state: stateValue(row.identity_state, ['CONFIRMED', 'UNKNOWN', 'UNCONFIRMED'], 'IDENTITY_STATE'),
  activity_state: stateValue(row.activity_state, ['ACTIVE', 'UNKNOWN', 'INACTIVE'], 'ACTIVITY_STATE'),
  email_state: stateValue(row.email_state, ['PASS', 'UNKNOWN', 'MISSING', 'UNSUITABLE'], 'EMAIL_STATE'),
  website_state: stateValue(
    row.website_state,
    ['NO_OFFICIAL_SITE_CONFIRMED', 'UNKNOWN', 'OFFICIAL_SITE_FOUND'],
    'WEBSITE_STATE',
  ),
  lead_blocked: boolValue(row.lead_blocked, 'LEAD_BLOCKED'),
  business_closed: boolValue(row.business_closed, 'BUSINESS_CLOSED'),
  prior_contact: boolValue(row.prior_contact, 'PRIOR_CONTACT'),
  duplicate: boolValue(row.duplicate, 'DUPLICATE'),
  pending_or_ambiguous_send: boolValue(row.pending_or_ambiguous_send, 'PENDING_OR_AMBIGUOUS_SEND'),
  suppressed: boolValue(row.suppressed, 'SUPPRESSED'),
  hard_bounce: boolValue(row.hard_bounce, 'HARD_BOUNCE'),
  opt_out: boolValue(row.opt_out, 'OPT_OUT'),
  do_not_contact: boolValue(row.do_not_contact, 'DO_NOT_CONTACT'),
  nao_contatar: boolValue(row.nao_contatar, 'NAO_CONTATAR'),
  email_channel_allowed: boolValue(row.email_channel_allowed, 'EMAIL_CHANNEL_ALLOWED'),
  current_evidence_present: boolValue(row.current_evidence_present, 'CURRENT_EVIDENCE_PRESENT'),
  legacy_status_only: boolValue(row.legacy_status_only, 'LEGACY_STATUS_ONLY'),
});

/** Read-only quality projection; it has no batch, provider, or delivery side effect. */
export async function listDaily6OpportunityShadow(
  db: Database,
  input: Readonly<{ city: string; category?: string; limit: number }>,
): Promise<readonly Daily6OpportunityShadowRow[]> {
  const rows = await db.execute<RawRow>(sql`
    select *
    from lead_finder_internal.list_daily6_opportunity_shadow(
      ${input.city},
      ${input.category ?? null},
      ${input.limit}
    )
  `);
  return rows.map(normalizeRow);
}
