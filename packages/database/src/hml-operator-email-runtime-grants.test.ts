import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const genericRuntime = readFileSync(
  new URL('../../../database/security/create_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const hmlRuntime = readFileSync(
  new URL('../../../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
);

const compact = (value: string) => value.replaceAll(/\s+/g, ' ').trim();

describe('HML operator email runtime grants', () => {
  it('keeps operator email table reads out of the generic runtime descriptor', () => {
    expect(genericRuntime).not.toMatch(
      /GRANT\s+SELECT\s+ON\s+TABLE[\s\S]*operator_email_test_attempts/i,
    );
    expect(genericRuntime).not.toMatch(
      /CREATE\s+POLICY\s+lead_finder_api_runtime_operator_email_(?:attempts|events)_select/i,
    );
  });

  it('allows only HML read access to operator email audit tables', () => {
    const source = compact(hmlRuntime);
    expect(source).toContain(
      compact(`GRANT SELECT ON TABLE
        public.operator_email_test_attempts,
        public.operator_email_test_events
      TO lead_finder_api_runtime;`),
    );
    expect(source).toContain('lead_finder_api_runtime_operator_email_attempts_select');
    expect(source).toContain('lead_finder_api_runtime_operator_email_events_select');
    expect(source).toMatch(/FOR SELECT TO lead_finder_api_runtime USING \(true\)/i);

    expect(hmlRuntime).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)[\s\S]*operator_email_test_/i,
    );
  });
});
