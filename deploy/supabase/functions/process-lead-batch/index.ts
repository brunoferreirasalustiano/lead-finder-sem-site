const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const secureEqual = async (left: string, right: string) => {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index]! ^ rightBytes[index]!;
  return difference === 0;
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const expected = Deno.env.get('CRON_INVOKE_SECRET');
  const apiSecret = Deno.env.get('INTERNAL_CRON_SECRET');
  const apiUrl = Deno.env.get('RENDER_INTERNAL_BATCH_URL');
  const authorization = request.headers.get('authorization');
  if (!expected || !apiSecret || !apiUrl || !authorization
    || !await secureEqual(authorization, `Bearer ${expected}`)) {
    return json(401, { error: 'Unauthorized' });
  }
  const idempotencyKey = request.headers.get('idempotency-key') ?? crypto.randomUUID().replaceAll('-', '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(apiUrl, { method: 'POST', signal: controller.signal, headers: {
      authorization: `Bearer ${apiSecret}`, 'x-cron-audience': 'lead-finder-batch',
      'idempotency-key': idempotencyKey, 'content-type': 'application/json',
    }, body: '{}' });
    if (!response.ok) return json(response.status >= 500 ? 503 : response.status, { error: 'Batch unavailable' });
    const report = await response.json() as Record<string, unknown>;
    return json(200, { outcome: report.outcome, attempted: report.attempted, processed: report.processed,
      durationMs: report.durationMs, executionSource: 'supabase-render' });
  } catch { return json(503, { error: 'Batch unavailable' }); }
  finally { clearTimeout(timeout); }
});
