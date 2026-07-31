import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../database/migrations/0029_operator_email_gmail_api_audit.sql', import.meta.url),
  'utf8',
);

describe('operator email Gmail API audit migration', () => {
  it('records every new restricted operator email event as GMAIL_API', () => {
    expect(migration).toContain("'GMAIL_API',");
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.append_operator_email_test_event',
    );
  });

  it('keeps historical SMTP labels valid without rewriting append-only events', () => {
    expect(migration).toContain("CHECK (provider IN ('GMAIL_SMTP', 'GMAIL_API'))");
    expect(migration).not.toMatch(
      /UPDATE\s+(?:public\.)?operator_email_test_events/i,
    );
  });

  it('preserves the restricted function ACL', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.append_operator_email_test_event',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.append_operator_email_test_event',
    );
  });
});
