import assert from 'node:assert/strict';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = postgres(databaseUrl, { max: 1 });
const requestIdentity = `diagnostic|${crypto.randomUUID()}|campinas-sp|discovery-v1`;
const payload = {
  input: { city: 'Campinas', state: 'SP', country: 'Brasil', category: 'barbearias', limit: 5 },
  collectionEgress: { enabled: true, configurationVersion: 1 },
  collectionRequestIdentity: requestIdentity,
  requestMode: 'DIAGNOSTIC',
};

try {
  await sql.begin(async (tx) => {
    const before = await tx<{ batches: number; ledger: number; outbox: number }[]>`
      SELECT
        (SELECT count(*)::int FROM public.daily6_batches) AS batches,
        (SELECT count(*)::int FROM public.daily6_send_ledger) AS ledger,
        (SELECT count(*)::int FROM public.campaign_outbox) AS outbox
    `;
    const first = await tx<{ id: string; status: string; replayed: boolean }[]>`
      SELECT id, status, replayed
      FROM lead_finder_internal.enqueue_diagnostic_collection_job(
        ${requestIdentity}, ${sql.json(payload)}::jsonb
      )
    `;
    const replay = await tx<{ id: string; status: string; replayed: boolean }[]>`
      SELECT id, status, replayed
      FROM lead_finder_internal.enqueue_diagnostic_collection_job(
        ${requestIdentity}, ${sql.json(payload)}::jsonb
      )
    `;
    assert.equal(first[0]?.status, 'PENDING');
    assert.equal(first[0]?.replayed, false);
    assert.equal(replay[0]?.id, first[0]?.id);
    assert.equal(replay[0]?.replayed, true);

    const job = await tx<{ request_mode: string }[]>`
      SELECT request_mode FROM public.collection_jobs WHERE request_identity = ${requestIdentity}
    `;
    assert.equal(job[0]?.request_mode, 'DIAGNOSTIC');

    const after = await tx<{ batches: number; ledger: number; outbox: number }[]>`
      SELECT
        (SELECT count(*)::int FROM public.daily6_batches) AS batches,
        (SELECT count(*)::int FROM public.daily6_send_ledger) AS ledger,
        (SELECT count(*)::int FROM public.campaign_outbox) AS outbox
    `;
    assert.deepEqual(after[0], before[0]);
    throw new Error('ROLLBACK_DIAGNOSTIC_TEST');
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== 'ROLLBACK_DIAGNOSTIC_TEST') throw error;
  });

  const immutableIdentity = `diagnostic|${crypto.randomUUID()}|campinas-sp|discovery-v1`;
  const immutablePayload = { ...payload, collectionRequestIdentity: immutableIdentity };
  await sql`
    SELECT * FROM lead_finder_internal.enqueue_diagnostic_collection_job(
      ${immutableIdentity}, ${sql.json(immutablePayload)}::jsonb
    )
  `;
  try {
    await assert.rejects(
      sql`UPDATE public.collection_jobs SET request_mode = 'COMMERCIAL' WHERE request_identity = ${immutableIdentity}`,
      /COLLECTION_EXECUTION_IDENTITY_IMMUTABLE/u,
    );
  } finally {
    await sql`DELETE FROM public.collection_jobs WHERE request_identity = ${immutableIdentity}`;
  }
  await assert.rejects(
    sql`
      INSERT INTO public.daily6_batches(batch_id, batch_date, slot, city_id, policy_version)
      VALUES (${requestIdentity}, current_date, '09', 'campinas-sp', 'daily6-v1')
    `,
    /DIAGNOSTIC_COMMERCIAL_SIDE_EFFECT_FORBIDDEN/u,
  );
  console.log('DIAGNOSTIC_COLLECTION_MODE_INTEGRATION=PASS');
} finally {
  await sql.end();
}
