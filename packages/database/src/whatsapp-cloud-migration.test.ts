import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../database/migrations/0035_whatsapp_cloud_delivery.sql', import.meta.url),
  'utf8',
);
const returningFixMigration = readFileSync(
  new URL('../../../database/migrations/0036_whatsapp_cloud_delivery_returning_fix.sql', import.meta.url),
  'utf8',
);
const errorMetadataMigration = readFileSync(
  new URL('../../../database/migrations/0037_whatsapp_cloud_error_metadata.sql', import.meta.url),
  'utf8',
);
const secondScopeMigration = readFileSync(
  new URL('../../../database/migrations/0038_whatsapp_cloud_hml_test_002_scope.sql', import.meta.url),
  'utf8',
);

describe('WhatsApp Cloud HML delivery migration', () => {
  it('uses append-only, one-scope reservations with no direct runtime table access', () => {
    expect(migration).toContain('UNIQUE (send_scope)');
    expect(migration).toContain('UNIQUE (preparation_id)');
    expect(migration).toContain("CHECK (send_scope = 'HML_TEST')");
    expect(migration).toContain("CHECK (event_type IN ('ACCEPTED','FAILED','AMBIGUOUS'))");
    expect(migration).toContain('REVOKE ALL ON public.pilot_manual_whatsapp_cloud_send_attempts');
    expect(migration).toContain('FROM lead_finder_api_runtime');
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.pilot_manual_whatsapp_cloud_send_/i);
  });

  it('exposes only allowlisted SECURITY DEFINER functions and sanitised fingerprints', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('create_manual_whatsapp_cloud_send_attempt(uuid, uuid, uuid, uuid, text, text, char, char, char, char, char)');
    expect(migration).toContain('append_manual_whatsapp_cloud_send_event(uuid, text, char, text)');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION');
    expect(migration).not.toMatch(/GRANT EXECUTE ON ALL FUNCTIONS/i);
    expect(migration).toContain('phone_number_id_fingerprint');
    expect(migration).toContain('recipient_fingerprint');
    expect(migration).toContain('message_fingerprint');
  });

  it('qualifies RETURNING columns to avoid RETURNS TABLE variable ambiguity', () => {
    expect(returningFixMigration).toContain('public.pilot_manual_whatsapp_cloud_send_attempts.id');
    expect(returningFixMigration).toContain('public.pilot_manual_whatsapp_cloud_send_events.id');
    expect(returningFixMigration).not.toMatch(/RETURNING\s+id\s*,/i);
  });

  it('persists only bounded provider diagnostics through a runtime allowlisted function', () => {
    expect(errorMetadataMigration).toContain('provider_http_status smallint');
    expect(errorMetadataMigration).toContain('meta_error_code text');
    expect(errorMetadataMigration).toContain('fbtrace_id text');
    expect(errorMetadataMigration).toContain('SECURITY DEFINER');
    expect(errorMetadataMigration).toContain('uuid, text, char, text, smallint, text, text, text, text');
    expect(errorMetadataMigration).toContain('GRANT EXECUTE ON FUNCTION');
    expect(errorMetadataMigration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.pilot_manual_whatsapp_cloud_send_/i);
    expect(errorMetadataMigration).not.toMatch(/request_body|access_token|recipient/i);
  });

  it('allows exactly the isolated second HML scope without resetting the first', () => {
    expect(secondScopeMigration).toContain("send_scope IN ('HML_TEST', 'HML_TEST_002')");
    expect(secondScopeMigration).toContain('DROP CONSTRAINT IF EXISTS');
    expect(secondScopeMigration).toContain('UNIQUE(send_scope)');
    expect(secondScopeMigration).toContain('HML_TEST is immutable evidence');
    expect(secondScopeMigration).toContain('HML_TEST_002');
  });
});
