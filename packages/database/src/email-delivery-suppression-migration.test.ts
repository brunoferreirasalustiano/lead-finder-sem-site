import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationFile = new URL(
  '../../../database/migrations/0041_email_delivery_suppression.sql',
  import.meta.url,
);
const loadMigration = () => readFile(migrationFile, 'utf8');

describe('email delivery suppression migration', () => {
  it('stores only contact references and sanitized event metadata', async () => {
    const sql = await loadMigration();
    const tableDefinition = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.contact_delivery_suppressions'),
      sql.indexOf('CREATE INDEX IF NOT EXISTS contact_delivery_suppressions_contact_idx'),
    );

    expect(tableDefinition).toContain('contact_id uuid NOT NULL');
    expect(tableDefinition).toContain('lead_id uuid NOT NULL');
    expect(tableDefinition).toContain('event_fingerprint char(64) NOT NULL');
    expect(tableDefinition).not.toMatch(/normalized_value|original_value|recipient|email_address/i);
    expect(tableDefinition).toContain("reason IN ('HARD_BOUNCE','INVALID_CONTACT','OPT_OUT','COMPLAINT')");
  });

  it('is append-only, RLS protected and unavailable to public runtime roles', async () => {
    const sql = await loadMigration();

    expect(sql).toContain('contact_delivery_suppressions_append_only');
    expect(sql).toContain('reject_manual_messaging_history_mutation()');
    expect(sql).toContain(
      'ALTER TABLE public.contact_delivery_suppressions ENABLE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.contact_delivery_suppressions FROM PUBLIC;',
    );
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.contact_delivery_suppressions\n      FROM lead_finder_api_runtime;',
    );
    expect(sql).not.toContain(
      'GRANT INSERT ON TABLE public.contact_delivery_suppressions TO service_role',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_email_delivery_suppression(',
    );
  });

  it('fails closed and maps permanent delivery outcomes to existing eligibility gates', async () => {
    const sql = await loadMigration();

    expect(sql).toContain("normalized_reason IN ('HARD_BOUNCE','INVALID_CONTACT')");
    expect(sql).toContain('SET is_valid=false,updated_at=clock_timestamp()');
    expect(sql).toContain("normalized_reason IN ('OPT_OUT','COMPLAINT')");
    expect(sql).toContain("p_lead_id,'EMAIL','EMAIL_' || normalized_reason,normalized_source");
    expect(sql).toContain("RAISE EXCEPTION 'suppression target is not an email contact'");
    expect(sql).toContain("RAISE EXCEPTION 'suppression fingerprint conflicts with persisted event'");
    expect(sql).toContain('hashtextextended(\'manual-messaging:\' || p_lead_id::text,0)');
  });
});
