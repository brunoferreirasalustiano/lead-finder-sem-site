import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSchedulerRequest } from './index.js';

const invokeSecret = 'scheduler-invoke-secret-that-is-long-enough';
const now = new Date('2026-08-28T16:07:01Z');

async function privateKeyPem(): Promise<string> {
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary)
    .match(/.{1,64}/gu)
    ?.join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`;
}

function request(method: 'GET' | 'POST', secret = invokeSecret): Request {
  return new Request('https://project.supabase.co/functions/v1/daily6-github-scheduler', {
    method,
    headers: { 'x-internal-scheduler-secret': secret },
  });
}

describe('Daily-6 Supabase scheduler handler', () => {
  let env: Record<string, string>;

  beforeEach(async () => {
    env = {
      DAILY6_SCHEDULER_INVOKE_SECRET: invokeSecret,
      DAILY6_GITHUB_APP_ID: '12345',
      DAILY6_GITHUB_APP_INSTALLATION_ID: '67890',
      DAILY6_GITHUB_APP_PRIVATE_KEY_PKCS8: await privateKeyPem(),
      DAILY6_HML_API_URL: 'https://lead-finder-api-hml.onrender.com/',
      SUPABASE_URL: 'https://ondvzdvlwntrnieodifi.supabase.co/',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    };
    vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails closed without configuration while keeping the response sanitized', async () => {
    delete env.DAILY6_SCHEDULER_INVOKE_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleSchedulerRequest(request('GET'), now);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'FAIL_CLOSED',
      errorClass: 'INTERNAL_UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid invocation secret before any network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleSchedulerRequest(request('GET', 'wrong-secret'), now);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      status: 'FAIL_CLOSED',
      errorClass: 'AUTH_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proves read-only ledger, HML configuration and GitHub workflow access in preflight', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('daily6_scheduler_dispatches?select=id&limit=0')) {
        expect(init?.method).toBeUndefined();
        return Response.json([]);
      }
      if (url.includes('/app/installations/')) return Response.json({ token: 't'.repeat(20) });
      if (url.includes('/actions/workflows/daily6-dispatcher.yml')) return Response.json({ id: 1 });
      throw new Error(`UNEXPECTED_FETCH:${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleSchedulerRequest(request('GET'), now);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schedulerAuth: 'PASS',
      githubAppAuth: 'PASS',
      workflowAccess: 'PASS',
      ledgerAccess: 'PASS',
      hmlConfiguration: 'PASS',
      sideEffects: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a non-HML Supabase URL before sending the service-role credential', async () => {
    env.SUPABASE_URL = 'https://example.com/';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleSchedulerRequest(request('GET'), now);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'FAIL_CLOSED',
      errorClass: 'INTERNAL_UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records invalid HML configuration as rejected before any GitHub dispatch', async () => {
    env.DAILY6_HML_API_URL = 'https://example.com/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('on_conflict=request_identity')) return Response.json([{ id: 'claimed' }]);
      if (init?.method === 'PATCH') return Response.json([{ status: 'DISPATCH_REJECTED' }]);
      throw new Error(`UNEXPECTED_FETCH:${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleSchedulerRequest(request('POST'), now);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'FAIL_CLOSED',
      errorClass: 'HML_CONFIGURATION_REJECTED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/dispatches'))).toBe(
      false,
    );
  });

  it('fails closed when a ledger transition returns an unexpected row', async () => {
    env.DAILY6_HML_API_URL = 'https://example.com/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('on_conflict=request_identity')) return Response.json([{ id: 'claimed' }]);
      if (init?.method === 'PATCH') return Response.json([{ status: 'CLAIMED' }]);
      throw new Error(`UNEXPECTED_FETCH:${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleSchedulerRequest(request('POST'), now);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'FAIL_CLOSED',
      errorClass: 'LEDGER_UPDATE_FAILED',
    });
  });

  it('accepts the legitimate race where the workflow claims the ledger before the Edge PATCH', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('on_conflict=request_identity')) return Response.json([{ id: 'claimed' }]);
      if (url.includes('/health/live')) return new Response(null, { status: 200 });
      if (url.includes('/app/installations/')) return Response.json({ token: 't'.repeat(20) });
      if (url.endsWith('/dispatches')) return new Response(null, { status: 204 });
      if (init?.method === 'PATCH') return Response.json([]);
      if (url.includes('select=status')) return Response.json([{ status: 'WORKFLOW_CLAIMED' }]);
      throw new Error(`UNEXPECTED_FETCH:${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleSchedulerRequest(request('POST'), now);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: 'DISPATCH_ACCEPTED' });
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/dispatches')),
    ).toHaveLength(1);
  });

  it('does not retry an ambiguous GitHub dispatch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('on_conflict=request_identity')) return Response.json([{ id: 'claimed' }]);
      if (url.includes('/health/live')) return new Response(null, { status: 200 });
      if (url.includes('/app/installations/')) return Response.json({ token: 't'.repeat(20) });
      if (url.endsWith('/dispatches')) throw new DOMException('timed out', 'TimeoutError');
      if (init?.method === 'PATCH') return Response.json([{ status: 'DISPATCH_AMBIGUOUS' }]);
      throw new Error(`UNEXPECTED_FETCH:${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleSchedulerRequest(request('POST'), now);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'FAIL_CLOSED',
      errorClass: 'GITHUB_AMBIGUOUS',
    });
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/dispatches')),
    ).toHaveLength(1);
  });
});
