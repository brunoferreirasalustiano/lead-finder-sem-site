import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type LogPrivacyFinding = Readonly<{ kind: string; count: number }>;
export type LogPrivacyReport = Readonly<{
  status: 'PASS' | 'FAIL';
  findings: readonly LogPrivacyFinding[];
  scannedLines: number;
}>;

const detectors: readonly [string, RegExp][] = [
  ['TOKEN_OR_SECRET', /(?:api[_-]?(?:key|token)|access[_-]?token|refresh[_-]?token|secret|password|credential)\s*(?:=|:)\s*["']?[^\s,"']+/iu],
  ['AUTHORIZATION_HEADER', /\bauthorization\s*[:=]|\bbearer\s+[\x21-\x7e]+/iu],
  ['COOKIE', /(?:set-cookie|\bcookie)\s*[:=]/iu],
  ['PHONE', /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/u],
  ['EMAIL', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu],
  ['CNPJ', /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/u],
  ['ADDRESS', /\b(?:rua|avenida|av\.|estrada|travessa)\s+[^,\n]{3,}/iu],
  ['FULL_PAYLOAD', /(?:["']?(?:payload|body|message|content|text)["']?\s*[:=]\s*)(?:\{|\[[^\]]{1,}|["'][^"']{20,})/iu],
  ['UNSANITIZED_STACK_TRACE', /(?:^\s*(?:Error|TypeError|ReferenceError|SyntaxError):|^\s*at\s+.+\([^\n]+:\d+:\d+\))/mu],
  ['SENSITIVE_URL_PARAMETER', /https?:\/\/\S+\?(?=\S*(?:token|secret|auth(?:orization)?|key|password|signature|cookie)=)/iu],
];

export function scanOperationalLogs(content: string): LogPrivacyReport {
  const counts = new Map<string, number>();
  const lines = content.split(/\r?\n/u);
  for (const line of lines) {
    for (const [kind, pattern] of detectors) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  const findings = [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
  return { status: findings.length === 0 ? 'PASS' : 'FAIL', findings, scannedLines: lines.length };
}

export async function verifyOperationalLogFile(file: string, output?: string): Promise<LogPrivacyReport> {
  const report = scanOperationalLogs(await readFile(file, 'utf8'));
  if (output) {
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, 'utf8');
  }
  return report;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1]?.endsWith('pilot-real-log-privacy.ts')) {
  const file = argumentValue('--file');
  const output = argumentValue('--output');
  if (!file) throw new Error('USAGE: npm run pilot:real:log-privacy -- --file <sanitized-log-file> [--output <report.json>]');
  const report = await verifyOperationalLogFile(file, output);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(serialized);
  if (report.status === 'FAIL') process.exitCode = 1;
}
