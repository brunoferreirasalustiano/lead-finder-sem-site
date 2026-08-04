import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { EXPECTED_WORKING_DIRECTORY } from './operator-test-whatsapp-preflight.js';

const sessionScript = readFileSync(
  new URL('./operator-test-whatsapp-session.ps1', import.meta.url),
  'utf8',
);
const syntheticSecrets = [
  'synthetic-api-token-0000000000000000000000000000',
  'synthetic-binding-key-0000000000000000000000000000',
  'synthetic-fingerprint-key-0000000000000000000000000',
];

describe('operator WhatsApp session launcher', () => {
  it('uses process-scoped environment variables and clears BSTR memory', () => {
    expect(sessionScript).toContain('[EnvironmentVariableTarget]::Process');
    expect(sessionScript).toContain('SecureStringToBSTR');
    expect(sessionScript).toContain('ZeroFreeBSTR');
    expect(sessionScript).toContain('finally');
    expect(sessionScript).toContain('Read-Host -Prompt "$Name (entrada oculta)" -AsSecureString');
  });

  it('checks child inheritance and starts the console only after a passing preflight', () => {
    expect(sessionScript).toContain('CHILD_ENV_PRESENT=true');
    expect(sessionScript).toContain('TSX_ENV_PRESENT=true');
    expect(sessionScript).toContain('NPM_ENV_PRESENT=true');
    const preflightPass = sessionScript.indexOf("Write-Output 'PREFLIGHT_RESULT=PASS'");
    const consoleStart = sessionScript.indexOf('scripts/operator-test-console-v2.ts');
    expect(preflightPass).toBeGreaterThan(-1);
    expect(consoleStart).toBeGreaterThan(preflightPass);
    expect(sessionScript).not.toMatch(/npm run operator:test:whatsapp(?!:preflight)/);
    expect(sessionScript).not.toContain('wa.me');
    expect(sessionScript).not.toContain('graph.facebook');
  });

  it.runIf(process.platform === 'win32')(
    'runs the synthetic test mode without starting the console',
    () => {
      const result = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          'scripts/operator-test-whatsapp-session.ps1',
          '-TestMode',
        ],
        {
          cwd: EXPECTED_WORKING_DIRECTORY,
          encoding: 'utf8',
          windowsHide: true,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('TEST_MODE=PASS');
      expect(result.stdout).toContain('CONSOLE_STARTED=false');
      expect(result.stderr).not.toContain('synthetic-');
      for (const secret of syntheticSecrets) {
        expect(result.stdout).not.toContain(secret);
        expect(result.stderr).not.toContain(secret);
      }
    },
    30_000,
  );
});
