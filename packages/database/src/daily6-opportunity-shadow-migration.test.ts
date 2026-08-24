import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = (await readFile(
  new URL('../../../database/migrations/0068_daily6_opportunity_shadow_tri_state.sql', import.meta.url),
  'utf8',
)).replace(/\r\n/gu, '\n');

const acl = (await readFile(
  new URL('../../../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
)).replace(/\r\n/gu, '\n');

describe('Daily-6 opportunity shadow tri-state migration', () => {
  it('returns the exact bounded tri-state projection', () => {
    const returnContract = migration.slice(
      migration.indexOf('RETURNS TABLE ('),
      migration.indexOf('LANGUAGE sql'),
    );
    expect(migration).toContain('CREATE OR REPLACE FUNCTION lead_finder_internal.list_daily6_opportunity_shadow(');
    expect(migration).toContain('identity_state text');
    expect(migration).toContain('activity_state text');
    expect(migration).toContain('email_state text');
    expect(migration).toContain('website_state text');
    expect(migration).toContain('pending_or_ambiguous_send boolean');
    expect(migration).toContain('current_evidence_present boolean');
    expect(migration).toContain('legacy_status_only boolean');
    expect(migration).toContain('LIMIT greatest(0, least(coalesce(p_limit, 0), 30))');
    expect(migration).toContain("THEN 'CONFIRMED'");
    expect(migration).toContain("THEN 'UNCONFIRMED'");
    expect(migration).toContain("THEN 'ACTIVE'");
    expect(migration).toContain("THEN 'INACTIVE'");
    expect(migration).toContain("THEN 'UNSUITABLE'");
    expect(migration).toContain("ELSE 'UNKNOWN'");
    expect(returnContract).not.toContain('contact_id uuid');
  });

  it('uses newest evidence with a confidence gate and preserves safety history', () => {
    expect(migration).toContain('e.observed_at DESC, e.created_at DESC, e.id DESC');
    expect(migration).toContain('e.confidence >= 0.850');
    expect(migration).toContain('public.lead_contacts');
    expect(migration).toContain('public.contact_email_business_evidence');
    expect(migration).toContain("e0.ownership = 'BUSINESS'");
    expect(migration).toContain("e0.human_decision IN ('APPROVED', 'AUTOMATED_COMPLIANCE')");
    expect(migration.indexOf("e0.ownership = 'BUSINESS'")).toBeLessThan(
      migration.indexOf('c0.updated_at DESC'),
    );
    expect(migration).toContain('public.campaign_opt_outs');
    expect(migration).toContain('public.contact_delivery_suppressions');
    expect(migration).toContain('public.email_precontact_delivery_suppressions');
    expect(migration).toContain('public.pilot_manual_message_preparations');
    expect(migration).toContain('public.pilot_manual_email_send_attempts');
    expect(migration).toContain('public.pilot_manual_email_send_events');
    expect(migration).toContain('public.daily6_send_ledger');
    expect(migration).toContain('lower(btrim(previous_contact.normalized_value)) = s.email_norm');
    expect(migration).toContain("message_event.result = 'OPT_OUT'");
    expect(migration).toContain("send_event.event_type = 'AMBIGUOUS'");
    expect(migration).toContain("terminal_event.event_type IN ('CANCELLED', 'CONTACT_CONFIRMED')");
    expect(migration).toContain("coalesce(f0.crm_stage = 'NAO_CONTATAR', false) AS nao_contatar");
    expect(migration).toContain('true AS email_channel_allowed');
    expect(migration).not.toContain("(f.email_state = 'PASS'");
    expect(migration).toContain("scored.email_state IN ('UNKNOWN', 'MISSING', 'UNSUITABLE')");
    expect(migration).toContain("scored.identity_state = 'UNCONFIRMED'");
    expect(migration).not.toMatch(/NOT f.business_closed[\s\S]{0,240}AS email_channel_allowed/iu);
  });

  it('is a least-privilege read boundary', () => {
    expect(migration).toContain('LANGUAGE sql');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_opportunity_shadow(text, text, integer) FROM PUBLIC');
    expect(migration).toContain('FROM anon');
    expect(migration).toContain('FROM authenticated');
    expect(migration).toContain('TO lead_finder_api_runtime');
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/iu);
    expect(migration).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\s+ON\s+TABLE/iu);
    expect(acl).toContain('lead_finder_internal.list_daily6_opportunity_shadow(text, text, integer)');
    expect(acl).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE[\s\S]*daily6_opportunity_shadow/iu);
  });
});
