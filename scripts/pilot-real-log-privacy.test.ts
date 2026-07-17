import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConsoleOperationalLogger } from '../apps/worker/src/operational-observability.js';
import { scanOperationalLogs, verifyOperationalLogFile } from './pilot-real-log-privacy.js';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pilot-log-privacy-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('pilot operational log privacy verifier', () => {
  it('passes technical identifiers and masked operational values', () => {
    const lines: string[] = [];
    const logger = createConsoleOperationalLogger((line) => lines.push(line));
    logger.info({
      correlationId: 'outbox:00000000-0000-4000-8000-000000000001:cycle:0',
      event: 'campaign_outbox_execution_decided', outcome: 'INELIGIBLE', reason: 'OPT_OUT', durationMs: 4,
    });
    expect(scanOperationalLogs(lines.join('\n'))).toMatchObject({ status: 'PASS', findings: [] });
  });

  it('detects synthetic sensitive data without repeating it in the report', () => {
    const unsafe = [
      'Authorization: Bearer synthetic-token-value',
      'cookie=session=synthetic-cookie',
      'contact=+55 11 98888-0000 email=synthetic@example.invalid',
      'cnpj=12.345.678/0001-90 address=Rua Sintetica 101',
      'payload={"message":"Mensagem comercial sintética completa para teste"}',
      'Error: synthetic unsanitized failure',
      'https://example.invalid/callback?token=synthetic-token',
    ].join('\n');
    const report = scanOperationalLogs(unsafe);
    expect(report.status).toBe('FAIL');
    expect(report.findings.map((finding) => finding.kind)).toEqual(expect.arrayContaining([
      'AUTHORIZATION_HEADER', 'COOKIE', 'PHONE', 'EMAIL', 'CNPJ', 'ADDRESS', 'FULL_PAYLOAD',
      'UNSANITIZED_STACK_TRACE', 'SENSITIVE_URL_PARAMETER',
    ]));
    expect(JSON.stringify(report)).not.toContain('synthetic-token-value');
    expect(JSON.stringify(report)).not.toContain('synthetic@example.invalid');
  });

  it('creates a missing evidence directory and writes the report after scanning', async () => {
    const directory = await createTemporaryDirectory();
    const input = join(directory, 'sanitized.log');
    const output = join(directory, '.pilot-evidence', 'log-privacy.json');
    await writeFile(input, 'event=pilot_preflight correlation_id=synthetic-001\n', 'utf8');

    const report = await verifyOperationalLogFile(input, output);

    expect(report).toMatchObject({ status: 'PASS', scannedLines: 2 });
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ status: 'PASS', findings: [] });
  });

  it('supports an existing evidence directory and nested output paths', async () => {
    const directory = await createTemporaryDirectory();
    const input = join(directory, 'sanitized.log');
    const output = join(directory, '.pilot-evidence', 'nested', 'privacy', 'report.json');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(input, 'event=pilot_preflight correlation_id=synthetic-002\n', 'utf8');

    await expect(verifyOperationalLogFile(input, output)).resolves.toMatchObject({ status: 'PASS' });
    await expect(readFile(output, 'utf8')).resolves.toContain('"status": "PASS"');
  });

  it('persists only classifications when the scanner detects sensitive content', async () => {
    const directory = await createTemporaryDirectory();
    const input = join(directory, 'unsafe.log');
    const output = join(directory, '.pilot-evidence', 'log-privacy.json');
    const secret = 'synthetic-token-value';
    await writeFile(input, `Authorization: Bearer ${secret}\n`, 'utf8');

    await expect(verifyOperationalLogFile(input, output)).resolves.toMatchObject({ status: 'FAIL' });
    const serialized = await readFile(output, 'utf8');
    expect(serialized).toContain('AUTHORIZATION_HEADER');
    expect(serialized).not.toContain(secret);
  });

  it.skipIf(process.platform === 'win32')('propagates an evidence-directory permission failure instead of reporting PASS', async () => {
    const directory = await createTemporaryDirectory();
    const input = join(directory, 'sanitized.log');
    const protectedDirectory = join(directory, 'protected');
    const output = join(protectedDirectory, 'log-privacy.json');
    await mkdir(protectedDirectory);
    await writeFile(input, 'event=pilot_preflight correlation_id=synthetic-003\n', 'utf8');
    await chmod(protectedDirectory, 0o500);

    await expect(verifyOperationalLogFile(input, output)).rejects.toMatchObject({ code: 'EACCES' });
    await chmod(protectedDirectory, 0o700);
  });
});
