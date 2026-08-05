import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const provisioningFile = new URL(
  '../../../database/security/create_lead_finder_contact_resolver_runtime.sql',
  import.meta.url,
);

const loadProvisioningSql = () => readFile(provisioningFile, 'utf8');

describe('contact resolver runtime role provisioning', () => {
  it('fails fast and encloses every mutation in one explicit transaction', async () => {
    const sql = await loadProvisioningSql();
    const outerBegins = sql.match(/^BEGIN;$/gm) ?? [];
    const outerCommits = sql.match(/^COMMIT;$/gm) ?? [];

    expect(sql.startsWith('\\set ON_ERROR_STOP on\n')).toBe(true);
    expect(outerBegins).toHaveLength(1);
    expect(outerCommits).toHaveLength(1);
    expect(sql.indexOf('BEGIN;')).toBeGreaterThan(sql.indexOf('\\set ON_ERROR_STOP on'));
    expect(sql.indexOf('COMMIT;')).toBeGreaterThan(sql.lastIndexOf('END $$;'));
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('preserves the hardened role attributes and narrow grants', async () => {
    const sql = await loadProvisioningSql();

    expect(sql).toContain('LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE');
    expect(sql).toContain('NOREPLICATION NOBYPASSRLS');
    expect(sql).toContain(
      "ALTER ROLE lead_finder_contact_resolver_runtime SET search_path = pg_catalog, public;",
    );
    expect(sql).toContain(
      "ALTER ROLE lead_finder_contact_resolver_runtime SET statement_timeout = '15s';",
    );
    expect(sql).toContain(
      "ALTER ROLE lead_finder_contact_resolver_runtime SET idle_in_transaction_session_timeout = '15s';",
    );
    expect(sql).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public');
    expect(sql).toContain('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public');
    expect(sql).toContain('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public');
    expect(sql).toContain(
      'public.resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)',
    );
  });
});
