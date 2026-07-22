import { writeFile } from 'node:fs/promises';

const pagesBaseUrl = (process.env.PAGES_BASE_URL ?? 'https://brunoferreirasalustiano.github.io/lead-finder-demos').replace(/\/$/, '');
const renderBaseUrl = (process.env.RENDER_BASE_URL ?? 'https://lead-finder-api-hml.onrender.com').replace(/\/$/, '');
const outputFile = process.env.OUTPUT_FILE ?? 'external-homologation-probe.json';
const userAgent = 'LeadFinderBrasil-HomologationProbe/1.0';

async function fetchWithRetry(url, { attempts = 4, timeoutMs = 120_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': userAgent, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status < 500 || attempt === attempts) return response;
      lastError = new Error(`HTTP_${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  throw lastError ?? new Error('FETCH_FAILED');
}

async function probeText(name, url) {
  try {
    console.error(`[probe] fetching ${name}: ${url}`);
    const response = await fetchWithRetry(url);
    return { name, url, http: response.status, text: await response.text(), error: null };
  } catch (error) {
    return { name, url, http: 0, text: '', error: error instanceof Error ? error.name : 'FETCH_FAILED' };
  }
}

function trackingFindings(html, label) {
  const findings = [];
  if (/<form(?:\s|>)/i.test(html)) findings.push(`FORBIDDEN_FORM:${label}`);
  if (/<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:googletagmanager|google-analytics|hotjar|clarity\.ms)/i.test(html)) {
    findings.push(`FORBIDDEN_TRACKING_SRC:${label}`);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;
    if (/\b(?:gtag|fbq)\s*\(/i.test(body)) {
      findings.push(`FORBIDDEN_TRACKING_INLINE:${label}`);
      break;
    }
  }
  return findings;
}

function requireText(html, expected, label, errors) {
  if (!html.includes(expected)) errors.push(`CONTENT_MISSING:${label}`);
}

function safeJsonStatus(text) {
  try {
    const value = JSON.parse(text);
    return typeof value?.status === 'string' ? value.status : 'MISSING_STATUS';
  } catch {
    return 'INVALID_JSON';
  }
}

const [home, privacy, barber] = await Promise.all([
  probeText('home', `${pagesBaseUrl}/`),
  probeText('privacy', `${pagesBaseUrl}/privacidade/`),
  probeText('barber', `${pagesBaseUrl}/barbearia/`),
]);

const pageErrors = [];
for (const page of [home, privacy, barber]) {
  if (page.http !== 200) pageErrors.push(`${page.name}:HTTP_${page.http}:${page.error ?? 'NO_ERROR'}`);
  pageErrors.push(...trackingFindings(page.text, page.name.toUpperCase()));
}
requireText(home.text, 'Lead Finder Brasil', 'HOME_BRAND', pageErrors);
requireText(privacy.text, 'Transparência sobre o site e os contatos comerciais.', 'PRIVACY_HEADING', pageErrors);
requireText(privacy.text, 'leadfinderbrasil@gmail.com', 'PRIVACY_CONTACT', pageErrors);
requireText(privacy.text, 'um número apenas publicado na internet não é considerado autorização', 'WHATSAPP_OPT_IN_RULE', pageErrors);
requireText(privacy.text, 'nenhum link, imagem, PDF, proposta ou preço no primeiro contato sem autorização', 'FIRST_CONTACT_SAFEGUARD', pageErrors);
requireText(privacy.text, 'O opt-out não exige justificativa', 'OPT_OUT_RULE', pageErrors);
requireText(barber.text, 'Lead Finder Brasil', 'BARBER_BRAND', pageErrors);

const pagesStatus = [home.http, privacy.http, barber.http].some((code) => code !== 200)
  ? 'UNREACHABLE'
  : pageErrors.length > 0
    ? 'CONTENT_MISMATCH'
    : 'SERVED';

const [renderLive, renderReady, renderSnapshot] = await Promise.all([
  probeText('render-live', `${renderBaseUrl}/health/live`),
  probeText('render-ready', `${renderBaseUrl}/health/ready`),
  probeText('render-snapshot', `${renderBaseUrl}/internal/operational-snapshot`),
]);

const renderErrors = [];
const liveBodyStatus = safeJsonStatus(renderLive.text);
const readyBodyStatus = safeJsonStatus(renderReady.text);
let renderStatus = 'UNREACHABLE';

if (renderLive.http === 200) {
  if (liveBodyStatus !== 'ok') renderErrors.push(`LIVE_BODY_STATUS:${liveBodyStatus}`);
  if (renderReady.http === 200) {
    if (readyBodyStatus === 'ok' || readyBodyStatus === 'degraded') renderStatus = 'OPERABLE';
    else {
      renderStatus = 'RESPONSE_MISMATCH';
      renderErrors.push(`READY_BODY_STATUS:${readyBodyStatus}`);
    }
  } else {
    renderStatus = 'LIVE_NOT_READY';
  }
}

if (![401, 403].includes(renderSnapshot.http)) {
  renderErrors.push(`SNAPSHOT_UNEXPECTED_HTTP:${renderSnapshot.http}`);
  if (renderSnapshot.http === 200) renderStatus = 'SECURITY_EXPOSURE';
}

const result = {
  pages: {
    baseUrl: pagesBaseUrl,
    status: pagesStatus,
    homeHttp: String(home.http).padStart(3, '0'),
    privacyHttp: String(privacy.http).padStart(3, '0'),
    barberHttp: String(barber.http).padStart(3, '0'),
    privacyNotice: pagesStatus === 'SERVED' ? 'VERIFIED' : 'UNVERIFIED',
    tracking: pagesStatus === 'SERVED' ? 'ABSENT' : 'UNVERIFIED',
    formCollection: pagesStatus === 'SERVED' ? 'ABSENT' : 'UNVERIFIED',
    errors: pageErrors,
  },
  render: {
    baseUrl: renderBaseUrl,
    status: renderStatus,
    liveHttp: String(renderLive.http).padStart(3, '0'),
    liveBodyStatus,
    readyHttp: String(renderReady.http).padStart(3, '0'),
    readyBodyStatus,
    snapshotUnauthenticatedHttp: String(renderSnapshot.http).padStart(3, '0'),
    errors: renderErrors,
  },
  externalEffects: { providers: false, messages: false, webhooks: false, writes: false },
};

await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));

if (pagesStatus !== 'SERVED' || renderStatus === 'SECURITY_EXPOSURE') process.exitCode = 1;
