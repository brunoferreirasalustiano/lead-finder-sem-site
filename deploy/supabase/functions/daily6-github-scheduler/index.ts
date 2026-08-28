import {
  classifyGithubDispatch,
  createGithubAppJwt,
  resolveNaturalSlot,
  secureSecretEquals,
} from './core.ts';

const GITHUB_OWNER = 'brunoferreirasalustiano';
const GITHUB_REPOSITORY = 'lead-finder-sem-site';
const GITHUB_WORKFLOW = 'daily6-dispatcher.yml';
const GITHUB_REF = 'main';
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

type DispatchStatus = 'DISPATCH_ACCEPTED' | 'DISPATCH_REJECTED' | 'DISPATCH_AMBIGUOUS';

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function githubInstallationToken(now: Date): Promise<string> {
  const appJwt = await createGithubAppJwt(
    requiredEnv('DAILY6_GITHUB_APP_ID'),
    requiredEnv('DAILY6_GITHUB_APP_PRIVATE_KEY_PKCS8'),
    now,
  );
  const installationId = requiredEnv('DAILY6_GITHUB_APP_INSTALLATION_ID');
  if (!/^[0-9]+$/u.test(installationId)) throw new Error('GITHUB_INSTALLATION_ID_INVALID');
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${appJwt}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`GITHUB_APP_AUTH_${response.status}`);
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || body.token.length < 20) {
    throw new Error('GITHUB_APP_AUTH_INVALID_RESPONSE');
  }
  return body.token;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  };
}

async function claimLedger(
  slot: NonNullable<ReturnType<typeof resolveNaturalSlot>>,
  correlationId: string,
  nonce: string,
) {
  const baseUrl = requiredEnv('SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(
    `${baseUrl}/rest/v1/daily6_scheduler_dispatches?on_conflict=request_identity`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
        prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify({
        request_identity: slot.requestIdentity,
        correlation_id: correlationId,
        dispatch_nonce: nonce,
        scheduled_at: slot.scheduledAt,
        status: 'CLAIMED',
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error('LEDGER_CLAIM_FAILED');
  const rows = (await response.json()) as unknown[];
  if (rows.length !== 1) throw new Error('LEDGER_IDENTITY_ALREADY_EXISTS');
}

async function updateLedger(
  nonce: string,
  status: DispatchStatus,
  githubHttpStatus: number | null,
  errorClass: string | null,
): Promise<boolean> {
  const baseUrl = requiredEnv('SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(
    `${baseUrl}/rest/v1/daily6_scheduler_dispatches?dispatch_nonce=eq.${encodeURIComponent(nonce)}&status=eq.CLAIMED`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({
        status,
        github_http_status: githubHttpStatus,
        error_class: errorClass,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  return response.ok;
}

async function preflight(now: Date): Promise<Response> {
  const token = await githubInstallationToken(now);
  const workflowResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/actions/workflows/${GITHUB_WORKFLOW}`,
    { headers: githubHeaders(token), signal: AbortSignal.timeout(10_000) },
  );
  if (!workflowResponse.ok)
    return json(503, { status: 'FAIL', errorClass: 'GITHUB_WORKFLOW_UNAVAILABLE' });
  return json(200, {
    schedulerAuth: 'PASS',
    githubAppAuth: 'PASS',
    workflowAccess: 'PASS',
    sideEffects: 0,
  });
}

async function dispatch(now: Date): Promise<Response> {
  const slot = resolveNaturalSlot(now);
  if (!slot) return json(409, { status: 'FAIL_CLOSED', errorClass: 'OUTSIDE_NATURAL_SLOT_WINDOW' });

  const correlationId = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  try {
    await claimLedger(slot, correlationId, nonce);
  } catch (error) {
    const errorClass = error instanceof Error ? error.message : 'LEDGER_CLAIM_FAILED';
    const status = errorClass === 'LEDGER_IDENTITY_ALREADY_EXISTS' ? 409 : 503;
    return json(status, { status: 'FAIL_CLOSED', errorClass });
  }

  try {
    const hmlApiUrl = new URL(requiredEnv('DAILY6_HML_API_URL'));
    if (
      hmlApiUrl.protocol !== 'https:' ||
      hmlApiUrl.hostname !== 'lead-finder-api-hml.onrender.com' ||
      hmlApiUrl.port !== '' ||
      hmlApiUrl.username !== '' ||
      hmlApiUrl.password !== '' ||
      hmlApiUrl.pathname !== '/' ||
      hmlApiUrl.search !== '' ||
      hmlApiUrl.hash !== ''
    ) {
      throw new Error('HML_API_URL_INVALID');
    }
    await fetch(new URL('/health/live', hmlApiUrl), {
      method: 'GET',
      signal: AbortSignal.timeout(12_000),
    }).catch(() => undefined);

    const token = await githubInstallationToken(now);
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({
          ref: GITHUB_REF,
          inputs: {
            scheduled_at: slot.scheduledAt,
            correlation_id: correlationId,
            dispatch_nonce: nonce,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    const { status, errorClass } = classifyGithubDispatch(response.status);

    if (!(await updateLedger(nonce, status, response.status, errorClass))) {
      return json(503, { status: 'FAIL_CLOSED', errorClass: 'LEDGER_UPDATE_FAILED' });
    }
    if (status !== 'DISPATCH_ACCEPTED') {
      return json(503, { status: 'FAIL_CLOSED', errorClass });
    }
    return json(202, { status: 'DISPATCH_ACCEPTED', correlationId });
  } catch {
    await updateLedger(nonce, 'DISPATCH_AMBIGUOUS', null, 'GITHUB_AMBIGUOUS').catch(() => false);
    return json(503, { status: 'FAIL_CLOSED', errorClass: 'GITHUB_AMBIGUOUS' });
  }
}

Deno.serve(async (request) => {
  const expectedSecret = requiredEnv('DAILY6_SCHEDULER_INVOKE_SECRET');
  const actualSecret = request.headers.get('x-internal-scheduler-secret') ?? '';
  if (!(await secureSecretEquals(actualSecret, expectedSecret))) {
    return json(401, { status: 'FAIL_CLOSED', errorClass: 'AUTH_INVALID' });
  }
  try {
    if (request.method === 'GET') return await preflight(new Date());
    if (request.method === 'POST') return await dispatch(new Date());
    return json(405, { status: 'FAIL_CLOSED', errorClass: 'METHOD_NOT_ALLOWED' });
  } catch {
    return json(503, { status: 'FAIL_CLOSED', errorClass: 'INTERNAL_UNAVAILABLE' });
  }
});
