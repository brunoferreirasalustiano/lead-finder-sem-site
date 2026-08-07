import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const createSql = readFileSync(
  new URL('../../../database/security/create_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const hmlSupplementSql = readFileSync(
  new URL('../../../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
);
const rollbackSql = readFileSync(
  new URL('../../../database/security/rollback_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);

const hmlRuntimeFunctions = [
  'public.create_manual_whatsapp_cloud_send_attempt(uuid, uuid, uuid, uuid, text, text, char, char, char, char, char)',
  'public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text)',
  'public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text, smallint, text, text, text, text)',
  'public.get_manual_whatsapp_cloud_send_scope_status(text)',
  'public.resolve_manual_email_contact_context(uuid, uuid, uuid, text)',
  'public.create_manual_email_preparation(uuid, uuid, uuid, text, text, text, character, text, character, jsonb)',
  'public.resolve_manual_email_preparation_context(uuid, text, boolean)',
  'public.append_manual_email_open_event(uuid, text, character, text)',
  'public.create_manual_email_send_attempt(uuid, text, character, character, character)',
  'public.append_manual_email_send_event(uuid, text, text, character, text)',
] as const;

describe('least-privilege runtime SQL replay contract', () => {
  it('keeps HML manual messaging grants out of the generic role and restores them explicitly', () => {
    const blanketRevokePosition = createSql.indexOf(
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM lead_finder_api_runtime;',
    );
    expect(blanketRevokePosition).toBeGreaterThanOrEqual(0);

    for (const signature of hmlRuntimeFunctions) {
      expect(createSql).not.toContain(signature);
      expect(hmlSupplementSql).toContain(signature);
    }

    expect(hmlSupplementSql).toContain(
      "RAISE EXCEPTION 'lead_finder_api_runtime must be provisioned before the HML supplement'",
    );
    expect(hmlSupplementSql).not.toContain('pilot_manual_whatsapp_cloud_send_attempts');
    expect(hmlSupplementSql).not.toContain('pilot_manual_whatsapp_cloud_send_events');
    expect(hmlSupplementSql).not.toContain('pilot_manual_email_send_attempts');
    expect(hmlSupplementSql).not.toContain('pilot_manual_email_send_events');
    expect(hmlSupplementSql).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/i);
  });

  it('keeps the runtime role non-inheriting while allowing postgres to administer it', () => {
    expect(createSql).toContain(
      'CREATE ROLE lead_finder_api_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    );
    expect(createSql).toContain("EXECUTE 'GRANT lead_finder_api_runtime TO postgres';");
  });

  it('revokes administrator memberships before dropping the runtime role', () => {
    const membershipLookupPosition = rollbackSql.indexOf(
      "WHERE granted_role.rolname = 'lead_finder_api_runtime'",
    );
    const membershipRevokePosition = rollbackSql.indexOf(
      "EXECUTE format('REVOKE lead_finder_api_runtime FROM %I', member_role.name);",
    );
    const dropRolePosition = rollbackSql.indexOf('DROP ROLE IF EXISTS lead_finder_api_runtime;');

    expect(membershipLookupPosition).toBeGreaterThanOrEqual(0);
    expect(membershipRevokePosition).toBeGreaterThan(membershipLookupPosition);
    expect(dropRolePosition).toBeGreaterThan(membershipRevokePosition);
  });
});
