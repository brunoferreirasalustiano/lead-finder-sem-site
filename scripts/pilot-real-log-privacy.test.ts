import { describe, expect, it } from 'vitest';
import { createConsoleOperationalLogger } from '../apps/worker/src/operational-observability.js';
import { scanOperationalLogs } from './pilot-real-log-privacy.js';

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
});
