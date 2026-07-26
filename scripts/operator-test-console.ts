import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approvedTemplates } from '@lead-finder/messaging';
import { z } from 'zod';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const BODY_LIMIT_BYTES = 8_192;
const RESPONSE_ACTIONS = [
  ['RECEIVED_CONFIRMED', 'Confirmar resposta recebida'],
  ['READ_CONFIRMED', 'Confirmar leitura'],
  ['NOT_RECEIVED', 'Registrar ausência de resposta'],
] as const;

const operatorPreparationSchema = z.object({
  preparationId: z.string().uuid(),
  state: z.literal('PREPARED'),
  purpose: z.literal('OPERATOR_TEST'),
  channel: z.literal('WHATSAPP'),
  templateId: z.literal('operator-whatsapp-channel-test'),
  templateVersion: z.literal('v1'),
  preparedAt: z.string().datetime({ offset: true }),
  replayed: z.boolean(),
}).strict();

type OperatorPreparation = z.infer<typeof operatorPreparationSchema>;

type ActivePreparation = OperatorPreparation & Readonly<{
  maskedPhone: string;
  message: string;
  link: string;
}>;

type ConsoleConfig = Readonly<{
  apiBaseUrl: string;
  apiToken: string;
  maskedPhone: string;
  message: string;
  link: string;
}>;

type ApiErrorBody = Readonly<{ code?: unknown }>;

export const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function parseApiBaseUrl(value: string): string {
  const url = new URL(value);
  const isSecure = url.protocol === 'https:';
  const isLocalHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!isSecure && !isLocalHttp) {
    throw new Error('LEAD_FINDER_API_URL must use HTTPS, except for loopback development');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('LEAD_FINDER_API_URL must not contain credentials, query or fragment');
  }
  return url.toString().replace(/\/$/, '');
}

export function parseOperatorPhone(value: string): string {
  const phone = value.trim();
  if (!E164_PATTERN.test(phone)) {
    throw new Error('OPERATOR_TEST_WHATSAPP_E164 must use E.164 format');
  }
  return phone;
}

export function isSafeWhatsAppUrl(value: string, expectedMessage: string): boolean {
  try {
    const url = new URL(value);
    const keys = [...url.searchParams.keys()];
    return url.protocol === 'https:'
      && url.hostname === 'wa.me'
      && !url.username
      && !url.password
      && !url.port
      && !url.hash
      && /^\/[1-9]\d{7,14}$/.test(url.pathname)
      && keys.length === 1
      && keys[0] === 'text'
      && url.searchParams.get('text') === expectedMessage;
  } catch {
    return false;
  }
}

export function createOperatorWhatsAppUrl(
  phoneValue: string,
  message = approvedTemplates.operatorWhatsappTestV1.body,
): string {
  const phone = parseOperatorPhone(phoneValue);
  if (message.length < 1 || message.length > 2_000) {
    throw new Error('Invalid operator test message');
  }
  const link = `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`;
  if (!isSafeWhatsAppUrl(link, message)) {
    throw new Error('Invalid operator test WhatsApp URL');
  }
  return link;
}

export function resolveOperatorConsoleConfig(environment: NodeJS.ProcessEnv): ConsoleConfig {
  if (environment['OPERATOR_TEST_AUTHORIZED'] !== 'true') {
    throw new Error('OPERATOR_TEST_AUTHORIZED must be true');
  }
  const apiUrl = environment['LEAD_FINDER_API_URL']?.trim() ?? '';
  const apiToken = environment['API_AUTH_TOKEN'] ?? '';
  const phoneValue = environment['OPERATOR_TEST_WHATSAPP_E164']?.trim() ?? '';
  if (!apiUrl) throw new Error('LEAD_FINDER_API_URL is required');
  if (apiToken.length < 32) throw new Error('API_AUTH_TOKEN must contain at least 32 characters');
  if (!phoneValue) throw new Error('OPERATOR_TEST_WHATSAPP_E164 is required');
  const phone = parseOperatorPhone(phoneValue);
  return {
    apiBaseUrl: parseApiBaseUrl(apiUrl),
    apiToken,
    maskedPhone: `••••${phone.slice(-4)}`,
    message: approvedTemplates.operatorWhatsappTestV1.body,
    link: createOperatorWhatsAppUrl(phone),
  };
}

export function validateOperatorPreparation(value: unknown): OperatorPreparation {
  const result = operatorPreparationSchema.safeParse(value);
  if (!result.success) {
    throw new Error('INVALID_OPERATOR_PREPARATION_RESPONSE');
  }
  return result.data;
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
    section + section { border-top: 1px solid #8885; margin-top: 26px; padding-top: 20px; }
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

const redirect = (response: ServerResponse, location: string) => {
  response.writeHead(303, { ...headers, location });
  response.end();
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
): Promise<unknown> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
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
  ${error ? `<p role="alert"><strong>Falha:</strong> ${escapeHtml(error)}</p>` : ''}
  <p>Destino pessoal autorizado terminado em <strong>${escapeHtml(config.maskedPhone)}</strong>.</p>
  <pre>${escapeHtml(config.message)}</pre>
  <form method="post" action="/prepare">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <button type="submit">Criar preparação auditada</button>
  </form>
  <p><small>O número e o texto permanecem na memória local. A API recebe somente a operação e persiste fingerprints.</small></p>`,
);

const renderPrepared = (csrfToken: string, preparation: ActivePreparation) => page(
  'Preparação auditada criada',
  `<h1>Preparação auditada criada</h1>
  <p class="notice">Registrar abertura não confirma envio. Revise o destinatário e o texto dentro do WhatsApp.</p>
  <dl>
    <dt>Preparação</dt><dd><code>${escapeHtml(preparation.preparationId)}</code></dd>
    <dt>Template</dt><dd><code>${escapeHtml(preparation.templateId)} ${escapeHtml(preparation.templateVersion)}</code></dd>
    <dt>Destino local</dt><dd><strong>${escapeHtml(preparation.maskedPhone)}</strong></dd>
  </dl>
  <pre>${escapeHtml(preparation.message)}</pre>
  <form method="post" action="/open" target="_blank">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="preparationId" value="${escapeHtml(preparation.preparationId)}">
    <button type="submit">Registrar abertura e abrir WhatsApp</button>
  </form>
  <h2>Depois da revisão manual</h2>
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
  </div>`,
);

const renderResponse = (csrfToken: string, preparation: ActivePreparation) => page(
  'Envio confirmado',
  `<h1>Envio confirmado</h1>
  <p class="notice">Registre uma resposta somente quando ela realmente existir. Caso contrário, encerre a console sem criar evento.</p>
  <div class="grid">
    ${RESPONSE_ACTIONS.map(([result, label]) => `<form method="post" action="/response">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="preparationId" value="${escapeHtml(preparation.preparationId)}">
      <input type="hidden" name="result" value="${result}">
      <button class="secondary" type="submit">${label}</button>
    </form>`).join('')}
  </div>
  <p><a href="/">Voltar sem registrar resposta</a></p>`,
);

const renderRecorded = (result: string) => page(
  'Evento registrado',
  `<h1>Evento registrado</h1><p><strong>${escapeHtml(result)}</strong></p><p><a href="/">Voltar à console</a></p>`,
);

export function startOperatorTestConsole(environment: NodeJS.ProcessEnv = process.env) {
  const config = resolveOperatorConsoleConfig(environment);
  const port = Number(environment['OPERATOR_TEST_CONSOLE_PORT'] ?? '4174');
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error('Invalid OPERATOR_TEST_CONSOLE_PORT');
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
        const payload = await apiRequest(config, '/operator-tests/whatsapp/preparations', {});
        const preparation = validateOperatorPreparation(payload);
        const active: ActivePreparation = {
          ...preparation,
          maskedPhone: config.maskedPhone,
          message: config.message,
          link: config.link,
        };
        preparations.set(active.preparationId, active);
        sendHtml(response, 200, renderPrepared(csrfToken, active));
        return;
      }

      const preparationId = requireUuid(formValue(form, 'preparationId'));
      const preparation = preparations.get(preparationId);
      if (!preparation) throw new Error('PREPARATION_NOT_IN_LOCAL_SESSION');

      if (url.pathname === '/open') {
        await apiRequest(config, `/operator-test-preparations/${preparationId}/open`, {});
        redirect(response, preparation.link);
        return;
      }

      if (url.pathname === '/confirm') {
        const result = formValue(form, 'result');
        if (!['SENT_CONFIRMED', 'NOT_SENT'].includes(result)) {
          throw new Error('INVALID_CONFIRMATION_RESULT');
        }
        await apiRequest(config, `/operator-test-preparations/${preparationId}/confirm`, { result });
        if (result === 'SENT_CONFIRMED') {
          sendHtml(response, 200, renderResponse(csrfToken, preparation));
        } else {
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
    console.log(`Authorized destination: ${config.maskedPhone}`);
    console.log('The console is loopback-only and never sends automatically.');
  });
  return server;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  startOperatorTestConsole();
}
