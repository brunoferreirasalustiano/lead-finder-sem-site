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

const whatsappRuntimeFunctions = [
  'public.create_manual_whatsapp_cloud_send_attempt(uuid, uuid, uuid, uuid, text, text, char, char, char, char, char)',
  'public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text)',
  'public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text, smallint, text, text, text, text)',
  'public.get_manual_whatsapp_cloud_send_scope_status(text)',
] as const;

describe('least-privilege runtime SQL replay contract', () => {
  it('keeps HML WhatsApp grants out of the generic role and restores them explicitly', () => {
    const blanketRevokePosition = createSql.indexOf(
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM lead_finder_api_runtime;',
    );
    expect(blanketRevokePosition).toBeGreaterThanOrEqual(0);

    for (const signature of whatsappRuntimeFunctions) {
      expect(createSql).not.toContain(signature);
      expect(hmlSupplementSql).toContain(signature);
    }

    expect(hmlSupplementSql).toContain(
      "RAISE EXCEPTION 'lead_finder_api_runtime must be provisioned before the HML supplement'",
    );
    expect(hmlSupplementSql).not.toContain('pilot_manual_whatsapp_cloud_send_attempts');
    expect(hmlSupplementSql).not.toContain('pilot_manual_whatsapp_cloud_send_events');
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
