import { sql } from 'drizzle-orm';
import type { Database } from './index.js';

export type Daily6OpportunityRow = Readonly<{
  lead_id: string;
  contact_id: string | null;
  city: string;
  category: string;
  business_identity_confirmed: boolean;
  business_active_pass: boolean;
  public_business_email_present: boolean;
  email_business_association_pass: boolean;
  email_inferred: boolean;
  official_site_found: boolean;
  site_search_high: boolean;
  prior_contact: boolean;
  duplicate: boolean;
  pending_or_ambiguous_send: boolean;
  suppressed: boolean;
  hard_bounce: boolean;
  opt_out: boolean;
  do_not_contact: boolean;
  nao_contatar: boolean;
  email_channel_allowed: boolean;
  current_verified_evidence_required: boolean;
  legacy_status_only: boolean;
  evidence_ids: unknown;
}>;

type RawDaily6OpportunityRow = Omit<Daily6OpportunityRow, keyof {
  business_identity_confirmed: boolean;
  business_active_pass: boolean;
  public_business_email_present: boolean;
  email_business_association_pass: boolean;
  email_inferred: boolean;
  official_site_found: boolean;
  site_search_high: boolean;
  prior_contact: boolean;
  duplicate: boolean;
  pending_or_ambiguous_send: boolean;
  suppressed: boolean;
  hard_bounce: boolean;
  opt_out: boolean;
  do_not_contact: boolean;
  nao_contatar: boolean;
  email_channel_allowed: boolean;
  current_verified_evidence_required: boolean;
  legacy_status_only: boolean;
}> & Record<string, unknown>;

const bool = (value: unknown): boolean => value === true || value === 't' || value === 'true';

const normalizeRow = (row: RawDaily6OpportunityRow): Daily6OpportunityRow => ({
  lead_id: String(row.lead_id),
  contact_id: row.contact_id === null || row.contact_id === undefined ? null : String(row.contact_id),
  city: String(row.city),
  category: String(row.category),
  business_identity_confirmed: bool(row.business_identity_confirmed),
  business_active_pass: bool(row.business_active_pass),
  public_business_email_present: bool(row.public_business_email_present),
  email_business_association_pass: bool(row.email_business_association_pass),
  email_inferred: bool(row.email_inferred),
  official_site_found: bool(row.official_site_found),
  site_search_high: bool(row.site_search_high),
  prior_contact: bool(row.prior_contact),
  duplicate: bool(row.duplicate),
  pending_or_ambiguous_send: bool(row.pending_or_ambiguous_send),
  suppressed: bool(row.suppressed),
  hard_bounce: bool(row.hard_bounce),
  opt_out: bool(row.opt_out),
  do_not_contact: bool(row.do_not_contact),
  nao_contatar: bool(row.nao_contatar),
  email_channel_allowed: bool(row.email_channel_allowed),
  current_verified_evidence_required: bool(row.current_verified_evidence_required),
  legacy_status_only: bool(row.legacy_status_only),
  evidence_ids: row.evidence_ids,
});

export async function listDaily6Opportunities(
  db: Database,
  input: Readonly<{ city: string; category?: string; limit: number }>,
): Promise<readonly Daily6OpportunityRow[]> {
  const rows = await db.execute<RawDaily6OpportunityRow>(sql`
    select *
    from lead_finder_internal.list_daily6_opportunities(
      ${input.city},
      ${input.category ?? null},
      ${input.limit}
    )
  `);
  return rows.map(normalizeRow);
}
