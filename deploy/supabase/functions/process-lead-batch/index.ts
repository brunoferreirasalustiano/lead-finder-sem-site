const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const expected = Deno.env.get('CRON_INVOKE_SECRET');
  const apiSecret = Deno.env.get('INTERNAL_CRON_SECRET');
  const apiUrl = Deno.env.get('RENDER_INTERNAL_BATCH_URL');
  const authorization = request.headers.get('authorization');
  if (!expected || !apiSecret || !apiUrl || authorization !== `Bearer ${expected}`) {
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
