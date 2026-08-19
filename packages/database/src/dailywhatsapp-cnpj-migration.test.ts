import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = (await readFile(
  new URL('../../../database/migrations/0066_dailywhatsapp_registry_evidence.sql', import.meta.url),
  'utf8',
)).replace(/\r\n/gu, '\n');

describe('DailyWhatsApp registry evidence migration', () => {
  it('keeps registry evidence append-only, private, and bounded', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.lead_registry_evidence');
    expect(migration).toContain("cnpj ~ '^[0-9]{14}$' AND lead_finder_internal.is_valid_numeric_cnpj(cnpj)");
    expect(migration).toContain("IF p_cnpj !~ '^[0-9./ -]+$' THEN RETURN false");
    expect(migration).toContain("length(replace(digits, substr(digits, 1, 1), '')) = 0");
    expect(migration).toContain('opening_date date');
    expect(migration).toContain('is_valid_numeric_cnpj');
    expect(migration).toContain('lead_registry_evidence_append_only');
    expect(migration).toContain('BEFORE UPDATE OR DELETE');
    expect(migration).toContain("match_decision IN ('CONFIRMED', 'AMBIGUOUS', 'REJECTED')");
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.lead_registry_evidence FROM PUBLIC');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('list_dailywhatsapp_recent_cnpj_opportunities');
    expect(migration).toContain("match_decision = 'CONFIRMED'");
    expect(migration).toContain('match_confidence >= 0.800');
    expect(migration).toContain("registration_status = 'ACTIVE'");
    expect(migration).toContain('opening_date IS NOT NULL');
    expect(migration).toContain('opening_date <= current_date');
    expect(migration).toContain('ORDER BY e.lead_id, e.observed_at DESC, e.created_at DESC, e.id DESC');
    expect(migration).toContain('PARTITION BY r.cnpj');
    expect(migration).toContain('pilot_manual_contacts_whatsapp_contact_idx');
    expect(migration).toContain('pilot_manual_message_preparations_whatsapp_contact_idx');
    expect(migration).toContain('pilot_manual_whatsapp_cloud_attempts_contact_idx');
    expect(migration).toContain('regexp_replace(previous_contact.normalized_value');
    expect(migration).toContain('JOIN public.lead_contacts opted_contact');
    expect(migration).toContain('regexp_replace(previous_lead.whatsapp');
    expect(migration).toContain('LIMIT greatest(0, least(coalesce(p_limit, 0), 30))');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.list_dailywhatsapp_recent_cnpj_opportunities');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION lead_finder_internal.list_dailywhatsapp_recent_cnpj_opportunities');
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s+/mi);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+[^;]*daily6_send_ledger/iu);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+[^;]*gmail/iu);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+[^;]*whatsapp-cloud/iu);
  });
});
