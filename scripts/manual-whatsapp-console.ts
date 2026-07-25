import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const BODY_LIMIT_BYTES = 8_192;
export const OPERATOR_TEST_MESSAGE =
  'Olá! Este é um teste interno autorizado do canal manual de WhatsApp do Lead Finder Brasil.\n\n' +
  'Nenhum lead real está envolvido. Não é necessário responder.';

type Preparation = Readonly<{
  preparationId: string;
  state: 'PREPARED';
  channel: 'WHATSAPP';
  templateId: string;
  templateVersion: string;
  message: string;
  link: string;
  replayed: boolean;
}>;

type OperatorTestConfig = Readonly<{
  maskedPhone: string;
  message: string;
  link: string;
}>;

type ApiConfig = Readonly<{
  baseUrl: string;
  token: string;
}>;

type ApiErrorBody = Readonly<{ code?: unknown }>;

export const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function parseApiBaseUrl(value: string): string {
  const url = new URL(value);
  const isSecure = url.protocol === 'https:';
  const isLocalHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!isSecure && !isLocalHttp) throw new Error('LEAD_FINDER_API_URL must use HTTPS, except for loopback development');
  if (url.username || url.password || url.search || url.hash) throw new Error('LEAD_FINDER_API_URL must not contain credentials, query or fragment');
  return url.toString().replace(/\/$/, '');
}

export function resolveApiConfig(environment: NodeJS.ProcessEnv): ApiConfig | undefined {
  const apiUrl = environment['LEAD_FINDER_API_URL']?.trim() ?? '';
  const apiToken = environment['API_AUTH_TOKEN'] ?? '';
  if (!apiUrl && !apiToken) return undefined;
  if (!apiUrl) throw new Error('LEAD_FINDER_API_URL is required when API_AUTH_TOKEN is configured');
  if (apiToken.length < 32) throw new Error('API_AUTH_TOKEN must contain at least 32 characters');
  return { baseUrl: parseApiBaseUrl(apiUrl), token: apiToken };
}

export function isSafeWhatsAppUrl(value: string, expectedMessage?: string): boolean {
  try {
    const url = new URL(value);
    const keys = [...url.searchParams.keys()];
    const message = url.searchParams.get('text');
    return url.protocol === 'https:'
      && url.hostname === 'wa.me'
      && !url.username
      && !url.password
      && !url.port
      && !url.hash
      && /^\/[1-9]\d{7,14}$/.test(url.pathname)
      && keys.length === 1
      && keys[0] === 'text'
      && typeof message === 'string'
      && message.length >= 1
      && message.length <= 2_000
      && (expectedMessage === undefined || message === expectedMessage);
  } catch {
    return false;
  }
}

export function parseOperatorTestPhone(value: string): string {
  const phone = value.trim();
  if (!E164_PATTERN.test(phone)) throw new Error('OPERATOR_TEST_WHATSAPP_E164 must use E.164 format');
  return phone;
}

export function createOperatorTestWhatsAppUrl(phoneValue: string, message = OPERATOR_TEST_MESSAGE): string {
  const phone = parseOperatorTestPhone(phoneValue);
  if (message.length < 1 || message.length > 2_000) throw new Error('Invalid operator test message');
  const link = `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`;
  if (!isSafeWhatsAppUrl(link, message)) throw new Error('Invalid operator test WhatsApp URL');
  return link;
}

export function operatorTestConfig(environment: NodeJS.ProcessEnv): OperatorTestConfig | undefined {
  const phoneValue = environment['OPERATOR_TEST_WHATSAPP_E164']?.trim();
  const authorized = environment['OPERATOR_TEST_AUTHORIZED'] === 'true';
  if (!phoneValue && !authorized) return undefined;
  if (!authorized) throw new Error('OPERATOR_TEST_AUTHORIZED must be true');
  if (!phoneValue) throw new Error('OPERATOR_TEST_WHATSAPP_E164 is required');
  const phone = parseOperatorTestPhone(phoneValue);
  return {
    maskedPhone: `••••${phone.slice(-4)}`,
    message: OPERATOR_TEST_MESSAGE,
    link: createOperatorTestWhatsAppUrl(phone),
  };
}

export function validatePreparation(value: unknown): Preparation {
  if (typeof value !== 'object' || value === null) throw new Error('INVALID_PREPARATION_RESPONSE');
  const item = value as Record<string, unknown>;
  const message = item['message'];
  const link = item['link'];
  if (
    typeof item['preparationId'] !== 'string'
    || !UUID_PATTERN.test(item['preparationId'])
    || item['state'] !== 'PREPARED'
    || item['channel'] !== 'WHATSAPP'
    || typeof item['templateId'] !== 'string'
    || typeof item['templateVersion'] !== 'string'
    || typeof message !== 'string'
    || message.length < 1
    || message.length > 2_000
    || typeof link !== 'string'
    || !isSafeWhatsAppUrl(link, message)
    || typeof item['replayed'] !== 'boolean'
  ) throw new Error('INVALID_PREPARATION_RESPONSE');
  return item as Preparation;
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
    label { display: block; margin: 14px 0 6px; font-weight: 650; }
    input, button { box-sizing: border-box; width: 100%; padding: 11px; font: inherit; }
    button { cursor: pointer; margin-top: 14px; font-weight: 700; }
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

const requireUuid = (value: string, field: string) => {
  if (!UUID_PATTERN.test(value)) throw new Error(`INVALID_${field.toUpperCase()}`);
  return value;
};

const renderOperatorTest = (csrfToken: string, test: OperatorTestConfig | undefined) => test
  ? `<section>
      <h2>Teste do operador</h2>
      <p class="notice">Destino pessoal autorizado terminado em <strong>${escapeHtml(test.maskedPhone)}</strong>. Este teste não cria lead, piloto ou registro comercial.</p>
      <pre>${escapeHtml(test.message)}</pre>
      <form method="post" action="/operator-test/open" target="_blank">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <button type="submit">Abrir teste no meu WhatsApp</button>
      </form>
      <p><small>Revise o número e o texto no WhatsApp. O envio continua sendo exclusivamente manual.</small></p>
    </section>`
  : `<section>
      <h2>Teste do operador</h2>
      <p>Modo não configurado. Defina as variáveis privadas <code>OPERATOR_TEST_AUTHORIZED</code> e <code>OPERATOR_TEST_WHATSAPP_E164</code> antes de iniciar a console.</p>
    </section>`;

const renderPilot = (csrfToken: string, api: ApiConfig | undefined) => api
  ? `<section>
      <h2>Fluxo de piloto</h2>
      <p>API: <code>${escapeHtml(new URL(api.baseUrl).origin)}</code></p>
      <p>Use esta área somente quando já existirem piloto, lead, revisão e contato autorizado no banco.</p>
      <form method="post" action="/prepare" autocomplete="off">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <label for="pilotRunId">Pilot Run ID</label>
        <input id="pilotRunId" name="pilotRunId" required pattern="[0-9a-fA-F-]{36}">
        <label for="leadId">Lead ID</label>
        <input id="leadId" name="leadId" required pattern="[0-9a-fA-F-]{36}">
        <label for="contactId">Contact ID autorizado</label>
        <input id="contactId" name="contactId" required pattern="[0-9a-fA-F-]{36}">
        <button type="submit">Preparar mensagem do piloto</button>
      </form>
    </section>`
  : `<section>
      <h2>Fluxo de piloto desativado</h2>
      <p>A API e o token não foram carregados. O teste do operador permanece isolado do fluxo comercial.</p>
    </section>`;

const renderHome = (
  csrfToken: string,
  api: ApiConfig | undefined,
  test: OperatorTestConfig | undefined,
  error?: string,
) => page(
  'Console WhatsApp — Lead Finder Brasil',
  `<h1>Console manual de WhatsApp</h1>
  <p class="notice">Esta ferramenta apenas prepara e abre o WhatsApp Business. Ela nunca envia uma mensagem automaticamente.</p>
  ${error ? `<p role="alert"><strong>Falha:</strong> ${escapeHtml(error)}</p>` : ''}
  ${renderOperatorTest(csrfToken, test)}
  ${renderPilot(csrfToken, api)}`,
);

const renderPrepared = (csrfToken: string, preparation: Preparation) => page(
  'Mensagem preparada',
  `<h1>Mensagem preparada</h1>
  <p class="notice">Revise o texto. O botão abaixo registra apenas a abertura e abre o WhatsApp em uma nova aba.</p>
  <dl>
    <dt>Preparação</dt><dd><code>${escapeHtml(preparation.preparationId)}</code></dd>
    <dt>Template</dt><dd><code>${escapeHtml(preparation.templateId)} ${escapeHtml(preparation.templateVersion)}</code></dd>
  </dl>
  <pre>${escapeHtml(preparation.message)}</pre>
  <form method="post" action="/open" target="_blank">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="preparationId" value="${escapeHtml(preparation.preparationId)}">
    <button type="submit">Registrar abertura e abrir WhatsApp</button>
  </form>
  <h2>Depois de revisar no WhatsApp</h2>
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
  </div>
  <p><a href="/">Preparar outro contato</a></p>`,
);

const renderRecorded = (result: string) => page(
  'Resultado registrado',
  `<h1>Resultado registrado</h1><p><strong>${escapeHtml(result)}</strong></p><p><a href="/">Voltar à console</a></p>`,
);

async function apiRequest(
  api: ApiConfig,
  path: string,
  idempotencyKey: string,
  body: object,
): Promise<unknown> {
  const response = await fetch(`${api.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${api.token}`,
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

export function startManualWhatsAppConsole(environment: NodeJS.ProcessEnv = process.env) {
  const api = resolveApiConfig(environment);
  const test = operatorTestConfig(environment);
  if (!api && !test) throw new Error('Configure the operator test or the pilot API before starting the console');

  const port = Number(environment['MANUAL_WHATSAPP_CONSOLE_PORT'] ?? '4173');
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) throw new Error('Invalid MANUAL_WHATSAPP_CONSOLE_PORT');

  const csrfToken = randomUUID();
  const preparations = new Map<string, Preparation>();
  const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = createServer(async (request, response) => {
    try {
      if (!request.headers.host || !expectedHosts.has(request.headers.host)) {
        sendHtml(response, 403, page('Acesso negado', '<h1>Acesso negado</h1>'));
        return;
      }
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      if (request.method === 'GET' && url.pathname === '/') {
        sendHtml(response, 200, renderHome(csrfToken, api, test));
        return;
      }
      if (request.method !== 'POST') {
        sendHtml(response, 404, page('Não encontrado', '<h1>Não encontrado</h1>'));
        return;
      }
      const form = new URLSearchParams(await readBody(request));
      if (formValue(form, 'csrf') !== csrfToken) throw new Error('INVALID_CSRF_TOKEN');

      if (url.pathname === '/operator-test/open') {
        if (!test) throw new Error('OPERATOR_TEST_NOT_CONFIGURED');
        redirect(response, test.link);
        return;
      }

      if (!api) throw new Error('PILOT_API_NOT_CONFIGURED');

      if (url.pathname === '/prepare') {
        const pilotRunId = requireUuid(formValue(form, 'pilotRunId'), 'pilotRunId');
        const leadId = requireUuid(formValue(form, 'leadId'), 'leadId');
        const contactId = requireUuid(formValue(form, 'contactId'), 'contactId');
        const payload = await apiRequest(
          api,
          `/pilots/${pilotRunId}/leads/${leadId}/manual-messages/prepare`,
          randomUUID(),
          {
            contactId,
            requestedChannel: 'WHATSAPP',
            templateId: 'pilot-whatsapp-first-contact',
            templateVersion: 'v1',
          },
        );
        const preparation = validatePreparation(payload);
        preparations.set(preparation.preparationId, preparation);
        sendHtml(response, 200, renderPrepared(csrfToken, preparation));
        return;
      }

      const preparationId = requireUuid(formValue(form, 'preparationId'), 'preparationId');
      const preparation = preparations.get(preparationId);
      if (!preparation) throw new Error('PREPARATION_NOT_IN_LOCAL_SESSION');

      if (url.pathname === '/open') {
        await apiRequest(
          api,
          `/manual-message-preparations/${preparationId}/open`,
          randomUUID(),
          {},
        );
        redirect(response, preparation.link);
        return;
      }

      if (url.pathname === '/confirm') {
        const result = formValue(form, 'result');
        if (!['SENT_CONFIRMED', 'NOT_SENT'].includes(result)) throw new Error('INVALID_CONFIRMATION_RESULT');
        await apiRequest(
          api,
          `/manual-message-preparations/${preparationId}/confirm`,
          randomUUID(),
          { result, observation: 'Recorded through localhost operator console' },
        );
        preparations.delete(preparationId);
        sendHtml(response, 200, renderRecorded(result));
        return;
      }

      sendHtml(response, 404, page('Não encontrado', '<h1>Não encontrado</h1>'));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      sendHtml(response, 422, renderHome(csrfToken, api, test, code));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Manual WhatsApp console: http://127.0.0.1:${port}`);
    console.log('The console is loopback-only and never sends automatically.');
    console.log(test ? `Operator test enabled for ${test.maskedPhone}.` : 'Operator test is disabled.');
    console.log(api ? `Pilot API configured for ${new URL(api.baseUrl).origin}.` : 'Pilot API is disabled.');
  });
  return server;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) startManualWhatsAppConsole();
