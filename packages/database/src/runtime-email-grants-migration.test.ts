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
const runtimeDescriptor = readFileSync(
  new URL('../../../database/security/create_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);

const emailTables = [
  'operator_email_test_attempts',
  'operator_email_test_events',
  'pilot_manual_email_send_attempts',
  'pilot_manual_email_send_events',
] as const;

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

  it('does not recreate direct email table grants or policies in the runtime descriptor', () => {
    expect(runtimeDescriptor).not.toMatch(/GRANT\s+(?:SELECT|INSERT)[\s\S]*pilot_manual_email_send/i);
    expect(runtimeDescriptor).not.toMatch(/CREATE POLICY\s+lead_finder_api_runtime_(?:operator_email|manual_email)/i);
    expect(runtimeDescriptor).toContain('create_operator_email_test_attempt');
    expect(runtimeDescriptor).toContain('append_operator_email_test_event');
  });

  it('reconciles only the four explicit SECURITY DEFINER function signatures', () => {
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
});
