import { sql } from 'drizzle-orm';
import type { Database } from './index.js';

export type DailyWhatsappRecentCnpjOpportunityRow = Readonly<{
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
  cnpj: string;
  cnpj_opening_date: string;
  cnpj_registration_status: string;
  cnpj_source: string;
}>;

type RawRow = Record<string, unknown>;

const textValue = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
const boolValue = (value: unknown): boolean => value === true || value === 't' || value === 'true';

const normalizeRow = (row: RawRow): DailyWhatsappRecentCnpjOpportunityRow => {
  const evidence = row.whatsapp_evidence;
  if (evidence !== 'LEAD_WHATSAPP_FIELD' && evidence !== 'POSSIBLE_WHATSAPP_FLAG') {
    throw new Error('WHATSAPP_EVIDENCE_NOT_PROVEN');
  }
  const cnpj = textValue(row.cnpj).replace(/[.\s/-]/gu, '');
  if (!/^\d{14}$/u.test(cnpj)) throw new Error('CNPJ_NOT_PROVEN');
  const openingDate = textValue(row.cnpj_opening_date);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(openingDate)) throw new Error('CNPJ_OPENING_DATE_NOT_PROVEN');
  const whatsapp = textValue(row.whatsapp_value);
  if (!/^\+[1-9][0-9]{7,14}$/u.test(whatsapp)) throw new Error('WHATSAPP_VALUE_NOT_PROVEN');
  return {
    lead_id: textValue(row.lead_id),
    contact_id: row.contact_id === null || row.contact_id === undefined ? null : textValue(row.contact_id),
    lead_name: row.lead_name === null || row.lead_name === undefined ? null : textValue(row.lead_name),
    city: textValue(row.city),
    category: textValue(row.category),
    whatsapp_value: whatsapp,
    whatsapp_source: textValue(row.whatsapp_source).slice(0, 64),
    whatsapp_evidence: evidence,
    website_status: textValue(row.website_status),
    qualification_status: textValue(row.qualification_status),
    business_identity_confirmed: boolValue(row.business_identity_confirmed),
    business_active_pass: boolValue(row.business_active_pass),
    cnpj,
    cnpj_opening_date: openingDate,
    cnpj_registration_status: textValue(row.cnpj_registration_status).slice(0, 64),
    cnpj_source: textValue(row.cnpj_source).slice(0, 128),
  };
};

/** Read-only CNPJ-recency ranking for manual WhatsApp review. */
export async function listDailyWhatsappRecentCnpjOpportunities(
  db: Database,
  input: Readonly<{ city: string; category?: string; openedSince: string; limit: number }>,
): Promise<readonly DailyWhatsappRecentCnpjOpportunityRow[]> {
  const rows = await db.execute<RawRow>(sql`
    select *
    from lead_finder_internal.list_dailywhatsapp_recent_cnpj_opportunities(
      ${input.city},
      ${input.category ?? null},
      ${input.openedSince}::date,
      ${input.limit}
    )
  `);
  return rows.map(normalizeRow);
}
