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
  });

  it('does not grant delivery, suppression, or DDL surfaces', () => {
    expect(sql).toContain('public.collection_jobs');
    expect(sql).toContain('public.lead_evidence');
    expect(executableSql).not.toMatch(/daily6_send_ledger|manual_email|gmail|contact_delivery_suppressions|\bSUPERUSER\b/i);
    expect(executableSql).not.toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+(TABLES|FUNCTIONS)/i);
  });
});
