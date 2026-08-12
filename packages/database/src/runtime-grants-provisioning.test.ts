import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const provisioner = readFileSync(
  new URL('../../../scripts/provision-hml-runtime.ts', import.meta.url),
  'utf8',
);
const integration = readFileSync(
  new URL('../../../scripts/runtime-grants-after-migrations.integration.ts', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const runbook = readFileSync(
  new URL('../../../docs/runbooks/hml-migration-safety.md', import.meta.url),
  'utf8',
);

const hmlFunctions = [
  'resolve_manual_email_contact_context',
  'create_manual_email_preparation',
  'resolve_manual_email_preparation_context',
  'append_manual_email_open_event',
  'get_manual_email_send_attempt',
  'create_manual_email_send_attempt',
  'append_manual_email_send_event',
  'run_hml_suppression_probe',
] as const;
const daily6Functions = [
  'reserve_daily6_send',
  'finalize_daily6_send',
  'list_daily6_candidates',
  'prepare_daily6_pilot_context',
  'ensure_daily6_batch',
  'bump_daily6_batch_metrics',
  'enqueue_collection_job',
] as const;

describe('post-migration HML runtime grant provisioning', () => {
  it('runs the generic deny-all descriptor before the HML supplement and fails closed', () => {
    expect(provisioner.indexOf('await sql.unsafe(genericSql);')).toBeGreaterThanOrEqual(0);
    expect(provisioner.indexOf('await sql.unsafe(hmlSql);'))
      .toBeGreaterThan(provisioner.indexOf('await sql.unsafe(genericSql);'));
    expect(provisioner).toContain('RUNTIME_ROLE_MISSING_AFTER_PROVISION');
    expect(provisioner).toContain('HML_RUNTIME_FUNCTION_ALLOWLIST_INCOMPLETE');
    expect(provisioner).toContain('HML_RUNTIME_PUBLIC_EXECUTE');
    expect(provisioner).toContain('HML_RUNTIME_PUBLIC_ROLE_EXECUTE');
    expect(provisioner).toContain('HML_RUNTIME_RESTRICTED_TABLE_ALLOWLIST_INCOMPLETE');
    expect(provisioner).toContain('directTablePrivileges.length !== restrictedTables.length');
    expect(provisioner).not.toContain('|| true');
    expect(provisioner).not.toContain('.catch(');
    for (const name of hmlFunctions) expect(provisioner).toContain(`'${name}'`);
    for (const name of daily6Functions) expect(provisioner).toContain(`'${name}'`);
    expect(provisioner).toContain('HML_RUNTIME_DAILY6_ALLOWLIST_INCOMPLETE');
  });

  it('reproduces 42501 before provisioning and verifies the post-fix allowlist', () => {
    expect(integration).toContain("assert.equal(before.some((row) => row.executable), false");
    expect(integration).toContain("code === '42501'");
    expect(integration).toContain("result: 'RUNTIME_GRANTS_AFTER_MIGRATIONS_PASS'");
    expect((integration.match(/await runProvision\(\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(integration).toContain("assert.equal(forbidden[0]?.executable, false)");
    expect(integration).toContain('publicExecute[0]?.executable === true');
    expect(integration).toContain('assertRestrictedTablesDenied');
  });

  it('makes CI provision an existing role before migration and reapply grants afterwards', () => {
    const integrationJob = workflow.slice(workflow.indexOf('  integration:'));
    const preProvision = integrationJob.indexOf('create_lead_finder_api_runtime.sql');
    const migrate = integrationJob.indexOf('npm run db:migrate && npm run db:migrate');
    const postProvision = integrationJob.indexOf('npm run test:runtime-grants-after-migrations');
    expect(preProvision).toBeGreaterThanOrEqual(0);
    expect(migrate).toBeGreaterThan(preProvision);
    expect(postProvision).toBeGreaterThan(migrate);

    const postgres17Job = workflow.slice(workflow.indexOf('  postgres17-migration-preflight:'));
    const postgres17Pre = postgres17Job.indexOf('create_lead_finder_api_runtime.sql');
    const postgres17Migrate = postgres17Job.indexOf('npm run db:migrate', postgres17Pre);
    const postgres17Post = postgres17Job.indexOf('npm run test:runtime-grants-after-migrations');
    expect(postgres17Pre).toBeGreaterThanOrEqual(0);
    expect(postgres17Migrate).toBeGreaterThan(postgres17Pre);
    expect(postgres17Post).toBeGreaterThan(postgres17Migrate);
    expect(workflow).not.toContain('test:runtime-grants-after-migrations || true');
  });

  it('documents the hosted sequence without authorizing hosted mutation', () => {
    expect(runbook).toContain('db:provision:hml-runtime');
    expect(runbook).toContain('db:migrate');
    expect(runbook).toContain('does not authorize');
    expect(runbook).toContain('fail-closed');
  });
});
