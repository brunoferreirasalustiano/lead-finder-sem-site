import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createOperatorRecipientProof,
  digestOperatorTestMessage,
  OPERATOR_RECIPIENT_BINDING_NONCE_BYTES,
  OPERATOR_RECIPIENT_BINDING_VERSION,
} from '@lead-finder/shared';
import {
  escapeHtml,
  resolveOperatorConsoleConfig,
  validateOperatorPreparation,
  validateOperatorPreparationReceipt,
} from './operator-test-console.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY_LIMIT_BYTES = 8_192;
const EXPECTED_PREPARATION_FIELDS = [
  'preparationId',
  'state',
  'purpose',
  'channel',
  'templateId',
  'templateVersion',
  'preparedAt',
  'replayed',
  'bindingVersion',
  'bindingNonce',
  'principalBinding',
  'recipientBindingReceipt',
] as const;
const RESPONSE_ACTIONS = [
  ['RECEIVED_CONFIRMED', 'Confirmar resposta recebida'],
  ['READ_CONFIRMED', 'Confirmar leitura'],
  ['NOT_RECEIVED', 'Registrar ausência de resposta'],
] as const;

type OperatorPreparation = ReturnType<typeof validateOperatorPreparation>;
type ConsoleConfig = ReturnType<typeof resolveOperatorConsoleConfig>;
type ActivePreparation = OperatorPreparation & Readonly<{
  preparationIdempotencyKey: string;
  maskedPhone: string;
  message: string;
  link: string;
}>;
type ApiErrorBody = Readonly<{ code?: unknown }>;

export class OperatorPreparationContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const fieldCode = (prefix: string, fields: readonly string[]) =>
  fields.length === 0 ? prefix : `${prefix}:${[...fields].sort().join(',')}`;

export function normalizeAndValidateOperatorPreparation(value: unknown): OperatorPreparation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperatorPreparationContractError('PREPARATION_RESPONSE_NOT_OBJECT');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const missing = EXPECTED_PREPARATION_FIELDS.filter((field) => !(field in record));
  if (missing.length > 0) {
    throw new OperatorPreparationContractError(fieldCode('PREPARATION_RESPONSE_MISSING_FIELDS', missing));
  }
  const expected = new Set<string>(EXPECTED_PREPARATION_FIELDS);
  const extra = keys.filter((field) => !expected.has(field));
  if (extra.length > 0) {
    throw new OperatorPreparationContractError(fieldCode('PREPARATION_RESPONSE_EXTRA_FIELDS', extra));
  }
  if (typeof record.preparedAt !== 'string') {
    throw new OperatorPreparationContractError('PREPARATION_RESPONSE_INVALID_TYPE:preparedAt');
  }
  const parsedTimestamp = Date.parse(record.preparedAt);
  if (!Number.isFinite(parsedTimestamp)) {
    throw new OperatorPreparationContractError('PREPARATION_RESPONSE_INVALID_TIMESTAMP');
  }
  const normalized = {
    ...record,
    preparedAt: new Date(parsedTimestamp).toISOString(),
  };
  try {
    return validateOperatorPreparation(normalized);
  } catch {
    throw new OperatorPreparationContractError('PREPARATION_RESPONSE_SCHEMA_INVALID');
  }
}

export function validateOperatorPreparationReceiptOrThrow(
  preparation: ActivePreparation,
  config: ConsoleConfig,
): void {
  try {
    validateOperatorPreparationReceipt(preparation, config);
  } catch {
    throw new OperatorPreparationContractError('PREPARATION_RECEIPT_INVALID');
  }
}

const page = (title: string, body: string) => `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 760px; margin: 40px auto; padding: 0 18px; line-height: 1.5; }
    main { border: 1px solid #8886; border-radius: 14px; padding: 24px; }
    button { box-sizing: border-box; width: 100%; padding: 11px; font: inherit; cursor: pointer; margin-top: 14px; font-weight: 700; }
    .secondary { font-weight: 500; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #8885; padding: 14px; border-radius: 10px; }
    .notice { padding: 12px; border-left: 4px solid currentColor; background: #8882; }
    .grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;

const headers = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'content-type': 'text/html; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

const sendHtml = (response: ServerResponse, status: number, html: string) => {
  response.writeHead(status, headers);
  response.end(html);
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT_BYTES) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const formValue = (form: URLSearchParams, key: string) => form.get(key)?.trim() ?? '';
const requireUuid = (value: string) => {
  if (!UUID_PATTERN.test(value)) throw new Error('INVALID_PREPARATION_ID');
  return value;
};

async function apiRequest(
  config: ConsoleConfig,
  path: string,
  body: object,
  idempotencyKey = randomUUID(),
): Promise<unknown> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as ApiErrorBody;
  if (!response.ok) {
    const code = typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
    throw new Error(code);
  }
  return payload;
}

const renderHome = (csrfToken: string, config: ConsoleConfig, error?: string) => page(
  'Teste auditado de WhatsApp — Lead Finder Brasil',
  `<h1>Teste auditado do operador</h1>
  <p class="notice">Esta console prepara e registra eventos na API, mas nunca envia automaticamente.</p>
  ${error ? `<p role="alert"><strong>Falha segura:</strong> <code>${escapeHtml(error)}</code></p>` : ''}
  <p>Destino pessoal autorizado terminado em <strong>${escapeHtml(config.maskedPhone)}</strong>.</p>
  <pre>${escapeHtml(config.message)}</pre>
  <form method="post" action="/prepare">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <button type="submit">Criar preparação auditada</button>
  </form>`,
);

const renderPrepared = (csrfToken: string, preparation: ActivePreparation) => page(
  'Preparação auditada criada',
  `<h1>Preparação auditada criada</h1>
  <p class="notice">Revise o destinatário e o texto antes de abrir o WhatsApp. Visualizar o link não registra abertura.</p>
  <dl>
    <dt>Preparação</dt><dd><code>${escapeHtml(preparation.preparationId)}</code></dd>
    <dt>Template</dt><dd><code>${escapeHtml(preparation.templateId)} ${escapeHtml(preparation.templateVersion)}</code></dd>
    <dt>Destino local</dt><dd><strong>${escapeHtml(preparation.maskedPhone)}</strong></dd>
  </dl>
  <pre>${escapeHtml(preparation.message)}</pre>
  <p><a href="${escapeHtml(preparation.link)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp manualmente</a></p>
  <form method="post" action="/open">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="preparationId" value="${escapeHtml(preparation.preparationId)}">
    <button type="submit">Registrar que abri o WhatsApp</button>
  </form>`,
);

const renderConfirmationActions = (csrfToken: string, preparation: ActivePreparation) => `
  <div class="grid">
    <form method="post" action="/confirm">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="preparationId" value="${escapeHtml(preparation.preparationId)}">
      <input type="hidden" name="result" value="SENT_CONFIRMED">
      <button type="submit">Confirmar que enviei</button>
    </form>
    <form method="post" action="/confirm">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="preparationId" value="${escapeHtml(preparation.preparationId)}">
      <input type="hidden" name="result" value="NOT_SENT">
      <button class="secondary" type="submit">Registrar que não enviei</button>
    </form>
  </div>`;

const renderOpened = (csrfToken: string, preparation: ActivePreparation) => page(
  'Abertura registrada',
  `<h1>Abertura registrada</h1>
  <p class="notice">OPENED_RECORDED=true<br>MESSAGE_SENT=false</p>
  <p>A abertura não confirma envio.</p>
  ${renderConfirmationActions(csrfToken, preparation)}`,
);

const renderResponse = (csrfToken: string, preparation: ActivePreparation) => page(
  'Envio confirmado',
  `<h1>Envio confirmado</h1>
  <p class="notice">Registre uma resposta somente quando ela realmente existir.</p>
  <div class="grid">
    ${RESPONSE_ACTIONS.map(([result, label]) => `<form method="post" action="/response">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="preparationId" value="${escapeHtml(preparation.preparationId)}">
      <input type="hidden" name="result" value="${result}">
      <button class="secondary" type="submit">${label}</button>
    </form>`).join('')}
  </div>`,
);

const renderRecorded = (result: string) => page(
  'Evento registrado',
  `<h1>Evento registrado</h1><p><strong>${escapeHtml(result)}</strong></p><p><a href="/">Voltar à console</a></p>`,
);

export function startOperatorTestConsoleV2(environment: NodeJS.ProcessEnv = process.env) {
  const config = resolveOperatorConsoleConfig(environment);
  const port = Number(environment['OPERATOR_TEST_CONSOLE_PORT'] ?? '4174');
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error('INVALID_OPERATOR_TEST_CONSOLE_PORT');
  }
  const csrfToken = randomUUID();
  const preparations = new Map<string, ActivePreparation>();
  const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = createServer(async (request, response) => {
    try {
      if (!request.headers.host || !expectedHosts.has(request.headers.host)) {
        sendHtml(response, 403, page('Acesso negado', '<h1>Acesso negado</h1>'));
        return;
      }
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      if (request.method === 'GET' && url.pathname === '/') {
        sendHtml(response, 200, renderHome(csrfToken, config));
        return;
      }
      if (request.method !== 'POST') {
        sendHtml(response, 404, page('Não encontrado', '<h1>Não encontrado</h1>'));
        return;
      }
      const form = new URLSearchParams(await readBody(request));
      if (formValue(form, 'csrf') !== csrfToken) throw new Error('INVALID_CSRF_TOKEN');

      if (url.pathname === '/prepare') {
        const bindingNonce = randomBytes(OPERATOR_RECIPIENT_BINDING_NONCE_BYTES).toString('base64url');
        const preparationIdempotencyKey = randomUUID();
        const bindingVersion = OPERATOR_RECIPIENT_BINDING_VERSION;
        const recipientProof = createOperatorRecipientProof(config.bindingKey, {
          bindingVersion,
          bindingNonce,
          idempotencyKey: preparationIdempotencyKey,
          recipientE164: config.phoneE164,
          templateId: 'operator-whatsapp-channel-test',
          templateVersion: 'v1',
          messageDigest: digestOperatorTestMessage(config.message),
        });
        const payload = await apiRequest(
          config,
          '/operator-tests/whatsapp/preparations',
          { bindingVersion, bindingNonce, recipientProof },
          preparationIdempotencyKey,
        );
        const preparation = normalizeAndValidateOperatorPreparation(payload);
        const active: ActivePreparation = {
          ...preparation,
          preparationIdempotencyKey,
          maskedPhone: config.maskedPhone,
          message: config.message,
          link: config.link,
        };
        if (active.bindingNonce !== bindingNonce) {
          throw new OperatorPreparationContractError('PREPARATION_NONCE_MISMATCH');
        }
        if (active.bindingVersion !== bindingVersion) {
          throw new OperatorPreparationContractError('PREPARATION_BINDING_VERSION_MISMATCH');
        }
        validateOperatorPreparationReceiptOrThrow(active, config);
        preparations.set(active.preparationId, active);
        sendHtml(response, 200, renderPrepared(csrfToken, active));
        return;
      }

      const preparationId = requireUuid(formValue(form, 'preparationId'));
      const preparation = preparations.get(preparationId);
      if (!preparation) throw new Error('PREPARATION_NOT_IN_LOCAL_SESSION');
      validateOperatorPreparationReceiptOrThrow(preparation, config);

      if (url.pathname === '/open') {
        await apiRequest(config, `/operator-test-preparations/${preparationId}/open`, {});
        sendHtml(response, 200, renderOpened(csrfToken, preparation));
        return;
      }
      if (url.pathname === '/confirm') {
        const result = formValue(form, 'result');
        if (!['SENT_CONFIRMED', 'NOT_SENT'].includes(result)) throw new Error('INVALID_CONFIRMATION_RESULT');
        await apiRequest(config, `/operator-test-preparations/${preparationId}/confirm`, { result });
        if (result === 'SENT_CONFIRMED') sendHtml(response, 200, renderResponse(csrfToken, preparation));
        else {
          preparations.delete(preparationId);
          sendHtml(response, 200, renderRecorded(result));
        }
        return;
      }
      if (url.pathname === '/response') {
        const result = formValue(form, 'result');
        if (!['RECEIVED_CONFIRMED', 'NOT_RECEIVED', 'READ_CONFIRMED'].includes(result)) {
          throw new Error('INVALID_RESPONSE_RESULT');
        }
        await apiRequest(config, `/operator-test-preparations/${preparationId}/response`, { result });
        preparations.delete(preparationId);
        sendHtml(response, 200, renderRecorded(result));
        return;
      }
      sendHtml(response, 404, page('Não encontrado', '<h1>Não encontrado</h1>'));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      sendHtml(response, 422, renderHome(csrfToken, config, code));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Operator test console: http://127.0.0.1:${port}`);
    console.log(`API: ${new URL(config.apiBaseUrl).origin}`);
    console.log('The console is loopback-only and never sends automatically.');
  });
  return server;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  startOperatorTestConsoleV2();
}
