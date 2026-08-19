import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = (await readFile(
  new URL('../../../database/migrations/0065_daily6_whatsapp_opportunity_shadow.sql', import.meta.url),
  'utf8',
)).replace(/\r\n/gu, '\n');

describe('Daily-6 WhatsApp opportunity shadow migration', () => {
  it('is bounded, authenticated, read-only, and preserves hard blockers', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION lead_finder_internal.list_daily6_whatsapp_opportunities');
    expect(migration).toContain('LANGUAGE sql');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('c0.possible_whatsapp = true');
    expect(migration).toContain("'LEAD_WHATSAPP_FIELD'");
    expect(migration).toContain('c.whatsapp_value IS NOT NULL');
    expect(migration).toContain('row_number() OVER');
    expect(migration).toContain('PARTITION BY c.whatsapp_value');
    expect(migration).toContain('NOT l.is_closed');
    expect(migration).toContain("website_evidence.result = 'OFFICIAL_SITE_FOUND'");
    expect(migration).toContain("upper(email_contact.type) = 'EMAIL'");
    expect(migration).toContain("o.channel IS NULL OR o.channel = 'WHATSAPP'");
    expect(migration).toContain("l.crm_stage IS DISTINCT FROM 'NAO_CONTATAR'");
    expect(migration).toContain('pilot_manual_whatsapp_cloud_send_attempts');
    expect(migration).toContain('LIMIT greatest(0, least(coalesce(p_limit, 0), 30))');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_whatsapp_opportunities(text, text, integer) FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION lead_finder_internal.list_daily6_whatsapp_opportunities(text, text, integer)');
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(migration).not.toContain('gmail');
    expect(migration).not.toContain('run-slot');
  });
});
