import { sql } from 'drizzle-orm';
import type { Database } from './index.js';

export type Daily6WhatsappOpportunityRow = Readonly<{
  lead_id: string;
  contact_id: string | null;
  lead_name: string | null;
  city: string;
  category: string;
  whatsapp_value: string;
  whatsapp_source: string;
  whatsapp_evidence: 'LEAD_WHATSAPP_FIELD' | 'POSSIBLE_WHATSAPP_FLAG';
  website_status: string;
  qualification_status: string;
  business_identity_confirmed: boolean;
  business_active_pass: boolean;
}>;

type RawDaily6WhatsappOpportunityRow = Record<string, unknown>;

const stringValue = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
const bool = (value: unknown): boolean => value === true || value === 't' || value === 'true';

const normalizeRow = (row: RawDaily6WhatsappOpportunityRow): Daily6WhatsappOpportunityRow => {
  const whatsappEvidence = row.whatsapp_evidence;
  if (whatsappEvidence !== 'LEAD_WHATSAPP_FIELD' && whatsappEvidence !== 'POSSIBLE_WHATSAPP_FLAG') {
    throw new Error('WHATSAPP_EVIDENCE_NOT_PROVEN');
  }
  const whatsappValue = stringValue(row.whatsapp_value);
  if (!/^\+[1-9][0-9]{7,14}$/u.test(whatsappValue)) {
    throw new Error('WHATSAPP_VALUE_NOT_PROVEN');
  }
  return {
    lead_id: stringValue(row.lead_id),
    contact_id: row.contact_id === null || row.contact_id === undefined ? null : stringValue(row.contact_id),
    lead_name: row.lead_name === null || row.lead_name === undefined ? null : stringValue(row.lead_name),
    city: stringValue(row.city),
    category: stringValue(row.category),
    whatsapp_value: whatsappValue,
    whatsapp_source: stringValue(row.whatsapp_source),
    whatsapp_evidence: whatsappEvidence,
    website_status: stringValue(row.website_status),
    qualification_status: stringValue(row.qualification_status),
    business_identity_confirmed: bool(row.business_identity_confirmed),
    business_active_pass: bool(row.business_active_pass),
  };
};

/**
 * Read-only manual-review funnel. This is deliberately independent from the
 * Daily-6 batch and send resolvers: it never creates a batch, ledger row, or
 * contact preparation and never calls a provider.
 */
export async function listDaily6WhatsappOpportunities(
  db: Database,
  input: Readonly<{ city: string; category?: string; limit: number }>,
): Promise<readonly Daily6WhatsappOpportunityRow[]> {
  const rows = await db.execute<RawDaily6WhatsappOpportunityRow>(sql`
    select *
    from lead_finder_internal.list_daily6_whatsapp_opportunities(
      ${input.city},
      ${input.category ?? null},
      ${input.limit}
    )
  `);
  return rows.map(normalizeRow);
}
