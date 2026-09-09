import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'database/security/create_lead_finder_discovery_runtime_hml.sql'), 'utf8');
const executableSql = sql.replace(/--.*$/gmu, '');

describe('HML discovery runtime role provisioning', () => {
  it('uses a dedicated non-owner, non-bypass role', () => {
    expect(sql).toContain('lead_finder_discovery_runtime');
    expect(sql).toContain('NOSUPERUSER');
    expect(sql).toContain('NOCREATEDB');
    expect(sql).toContain('NOCREATEROLE');
    expect(sql).toContain('NOBYPASSRLS');
    expect(sql).not.toMatch(/GRANT\s+(postgres|service_role)\s+TO\s+lead_finder_discovery_runtime/i);
    expect(sql).not.toMatch(/GRANT\s+lead_finder_discovery_runtime\s+TO\s+postgres/i);
  });

  it('does not grant delivery, suppression, or DDL surfaces', () => {
    expect(sql).toContain('public.collection_jobs');
    expect(sql).toContain('public.lead_evidence');
    expect(executableSql).not.toMatch(/daily6_send_ledger|manual_email|gmail|contact_delivery_suppressions|\bSUPERUSER\b/i);
    expect(executableSql).not.toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+(TABLES|FUNCTIONS)/i);
  });

  it('grants the exact location and collection-finalization capabilities used by the worker', () => {
    expect(executableSql).toMatch(
      /GRANT\s+UPDATE\s*\(\s*city\s*,\s*state\s*\)\s+ON TABLE public\.leads\s+TO lead_finder_discovery_runtime/i,
    );
    expect(executableSql).toMatch(
      /GRANT\s+EXECUTE\s+ON FUNCTION lead_finder_internal\.sync_daily6_batch_from_collection\(text\)\s+TO lead_finder_discovery_runtime/i,
    );
    expect(executableSql).not.toMatch(/GRANT\s+UPDATE\s+ON\s+(TABLE\s+)?public\.leads/i);
  });

  it('requires RLS and scopes policies to the discovery role only', () => {
    expect(executableSql).toContain('relrowsecurity');
    expect(executableSql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    for (const table of ['schema_migrations', 'collection_jobs', 'leads', 'lead_contacts', 'lead_evidence']) {
      expect(executableSql).toMatch(new RegExp(`CREATE POLICY[\\s\\S]+ON public\\.${table}[\\s\\S]+TO lead_finder_discovery_runtime`, 'i'));
    }
    expect(executableSql).not.toMatch(/FOR\s+DELETE/i);
    expect(executableSql).not.toMatch(/TO\s+(PUBLIC|authenticated|anon)\b/i);
  });
});
