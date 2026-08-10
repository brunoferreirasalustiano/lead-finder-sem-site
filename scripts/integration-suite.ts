import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const integrationScripts = [
  'scripts/migration-0010-upgrade-test.ts',
  'scripts/migration-0012-pilot-integrity-test.ts',
  'scripts/migration-0048-upgrade-test.ts',
  'scripts/migration-0049-existing-duplicate-hardening-test.ts',
  'scripts/integration-test.ts',
  'packages/database/src/prospecting-metrics.integration.ts',
  'scripts/email-delivery-suppression.integration.ts',
  'scripts/precontact-email-delivery-suppression.integration.ts',
] as const;

const tsxCommand = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';

function writeCiFailure(script: string, exitCode: number, signal: NodeJS.Signals | null): void {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    return;
  }

  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/pilot-readiness.json',
    `${JSON.stringify(
      {
        result: 'INTEGRATION_DIAGNOSTIC_FAILURE',
        failed_script: script,
        exit_code: exitCode,
        signal,
        sha: process.env.GITHUB_SHA ?? null,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

for (const script of integrationScripts) {
  console.log(`[integration-suite] START ${script}`);

  const result = spawnSync(tsxCommand, [script], {
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[integration-suite] SPAWN_ERROR ${script}: ${result.error.message}`);
    writeCiFailure(script, 1, null);
    process.exit(1);
  }

  if (result.status !== 0) {
    const exitCode = result.status ?? 1;
    console.error(`[integration-suite] FAIL ${script} (exit ${exitCode})`);
    writeCiFailure(script, exitCode, result.signal);
    process.exit(exitCode);
  }

  console.log(`[integration-suite] PASS ${script}`);
}

console.log('[integration-suite] PASS all');
