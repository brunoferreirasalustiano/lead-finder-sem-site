import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../database/migrations/0032_runtime_email_table_grants_reconciliation.sql', import.meta.url),
  'utf8',
);
const executeMigration = readFileSync(
  new URL('../../../database/migrations/0034_runtime_security_definer_execute_grants.sql', import.meta.url),
  'utf8',
);
const restrictedEmailMigration = readFileSync(
  new URL('../../../database/migrations/0042_restricted_manual_email_consumer.sql', import.meta.url),
  'utf8',
);
const restrictedEmailHardeningMigration = readFileSync(
  new URL('../../../database/migrations/0043_restricted_manual_email_hardening.sql', import.meta.url),
  'utf8',
);
const runtimeDescriptor = readFileSync(
  new URL('../../../database/security/create_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const runtimeHmlDescriptor = readFileSync(
  new URL('../../../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
);

const emailTables = [
  'operator_email_test_attempts',
  'operator_email_test_events',
  'pilot_manual_email_send_attempts',
  'pilot_manual_email_send_events',
] as const;

const restrictedEmailFunctions = [
  'public.resolve_manual_email_contact_context(uuid,uuid,uuid,text)',
  'public.create_manual_email_preparation(uuid,uuid,uuid,text,text,text,character,text,character,jsonb)',
  'public.resolve_manual_email_preparation_context(uuid,text,boolean)',
  'public.append_manual_email_open_event(uuid,text,character,text)',
  'public.get_manual_email_send_attempt(uuid,text)',
  'public.create_manual_email_send_attempt(uuid,text,character,character,character)',
  'public.append_manual_email_send_event(uuid,text,text,character,text)',
] as const;

const compact = (value: string) => value.replaceAll(' ', '').replaceAll('\n', '');

describe('runtime email grants reconciliation', () => {
  it('revokes direct table access and removes every known runtime email policy', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE');
    for (const table of emailTables) expect(migration).toContain(`public.${table}`);
    for (const policy of [
      'lead_finder_api_runtime_operator_email_attempts_select',
      'lead_finder_api_runtime_operator_email_events_select',
      'lead_finder_api_runtime_manual_email_attempts',
      'lead_finder_api_runtime_manual_email_attempts_insert',
      'lead_finder_api_runtime_manual_email_events',
      'lead_finder_api_runtime_manual_email_events_insert',
    ]) expect(migration).toContain(`DROP POLICY IF EXISTS ${policy}`);
  });

  it('keeps the generic runtime descriptor free from HML manual email capabilities', () => {
    expect(runtimeDescriptor).not.toMatch(/GRANT\s+(?:SELECT|INSERT)[\s\S]*pilot_manual_email_send/i);
    expect(runtimeDescriptor).not.toMatch(/CREATE POLICY\s+lead_finder_api_runtime_(?:operator_email|manual_email)/i);
    expect(runtimeDescriptor).toContain('create_operator_email_test_attempt');
    expect(runtimeDescriptor).toContain('append_operator_email_test_event');
    for (const signature of restrictedEmailFunctions) {
      expect(compact(runtimeDescriptor)).not.toContain(compact(signature));
      expect(compact(runtimeHmlDescriptor)).toContain(compact(signature));
    }
  });

  it('reconciles only the four historical SECURITY DEFINER signatures in migration 0034', () => {
    const signatures = [
      'public.create_operator_channel_test_preparation(char, char, char, char, char, char)',
      'public.append_operator_channel_test_event(uuid, text, text, char, char, char)',
      'public.create_operator_email_test_attempt(char, char, char, char, char, char)',
      'public.append_operator_email_test_event(uuid, text, char, char, char)',
    ];
    expect(executeMigration).toContain('REVOKE EXECUTE ON FUNCTION');
    expect(executeMigration).toContain('FROM PUBLIC');
    expect(executeMigration).toContain('FROM anon');
    expect(executeMigration).toContain('FROM authenticated');
    expect(executeMigration).toContain('TO lead_finder_api_runtime');
    for (const signature of signatures) expect(executeMigration).toContain(signature);
    expect(executeMigration).not.toMatch(/GRANT EXECUTE ON ALL FUNCTIONS/i);
  });

  it('keeps the original six narrow functions without restoring direct table access', () => {
    expect(restrictedEmailMigration).toContain('SECURITY DEFINER');
    expect(restrictedEmailMigration).toContain("p_event_type NOT IN ('DELIVERED','FAILED','AMBIGUOUS')");
    expect(restrictedEmailMigration).toContain("p_template_version <> 'v2'");
    expect(restrictedEmailMigration).toContain("event.event_type='OPENED'");
    expect(restrictedEmailMigration).toContain('FOR UPDATE');
    expect(restrictedEmailMigration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.pilot_manual_email/i);
    expect(restrictedEmailMigration).not.toMatch(/CREATE POLICY/i);
    expect(restrictedEmailMigration).not.toMatch(/GRANT EXECUTE ON ALL FUNCTIONS/i);
  });

  it('hardens snapshots, principals, replay and leases at the SQL boundary', () => {
    expect(restrictedEmailHardeningMigration).toContain('lease_expires_at');
    expect(restrictedEmailHardeningMigration).toContain('snapshot_key_count <> 8');
    expect(restrictedEmailHardeningMigration).toContain("p_result_snapshot->'variables' IS DISTINCT FROM '{}'::jsonb");
    expect(restrictedEmailHardeningMigration).toContain('extensions.digest');
    expect(restrictedEmailHardeningMigration).toContain("existing.template_version <> 'v1'");
    expect(restrictedEmailHardeningMigration).toContain('p_operator_principal_id IS NULL');
    expect(restrictedEmailHardeningMigration).toContain('RESERVATION_WITHOUT_TERMINAL_EVENT');
    expect(restrictedEmailHardeningMigration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.pilot_manual_email/i);
    expect(restrictedEmailHardeningMigration).not.toMatch(/CREATE POLICY/i);
    expect(restrictedEmailHardeningMigration).not.toMatch(/GRANT EXECUTE ON ALL FUNCTIONS/i);
    for (const signature of restrictedEmailFunctions) {
      expect(compact(runtimeHmlDescriptor)).toContain(compact(signature));
    }
  });
});
