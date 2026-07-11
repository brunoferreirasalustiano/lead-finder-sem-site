import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { count, eq } from 'drizzle-orm';
import {
  collectionJobs,
  createDatabase,
  enqueueCollection,
  leadContacts,
  leadEvidence,
  leadQualificationHistory,
  leads,
  listOutreachEligibleLeads,
} from '@lead-finder/database';
import { OverpassClient } from '@lead-finder/overpass-client';
import { buildApp } from '../apps/api/src/app.js';
import { processNextJob } from '../apps/worker/src/process-job.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const { db, close } = createDatabase(databaseUrl);
const responses: Array<{ status: number; body: string; delay?: number }> = [];
const server = createServer((_request, response) => {
  const next = responses.shift() ?? { status: 200, body: JSON.stringify({ elements: [] }) };
  setTimeout(() => {
    response.writeHead(next.status, { 'content-type': 'application/json' });
    response.end(next.body);
  }, next.delay ?? 0);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Mock server failed to bind');
const overpass = new OverpassClient({
  endpoint: `http://127.0.0.1:${address.port}`,
  timeoutMs: 1_000,
  maxRetries: 0,
});
const app = buildApp(db, { dailyLeadLimit: 5 });

try {
  await db.delete(collectionJobs);
  await db.delete(leads);
  const ready = await app.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(ready.statusCode, 200);

  const invalidCases = [
    ['/leads/not-a-uuid', 400],
    ['/leads/00000000-0000-4000-8000-000000000000', 404],
    ['/leads?page=0', 400],
    ['/leads?pageSize=10000', 400],
    ['/leads?minScore=-1', 400],
    ['/leads?status=UNKNOWN', 400],
    ['/leads?category=unknown', 400],
  ] as const;
  for (const [url, expected] of invalidCases)
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, expected, url);
  assert.equal((await app.inject({ method: 'POST', url: '/collect' })).statusCode, 400);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/collect',
        payload: { category: 'oficinas', query: '[out:json]' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/collect',
        payload: { category: 'oficinas', limit: 6 },
      })
    ).statusCode,
    400,
  );

  const payload = {
    city: 'Campinas',
    state: 'SP',
    country: 'Brasil',
    category: 'oficinas',
    limit: 5,
  };
  const accepted = await app.inject({ method: 'POST', url: '/collect', payload });
  assert.equal(accepted.statusCode, 202);
  responses.push({
    status: 200,
    body: JSON.stringify({
      elements: [
        {
          type: 'node',
          id: 1001,
          lat: -22.9,
          lon: -47.1,
          tags: {
            name: '=Oficina, "São José"\nCentro',
            phone: '+5511999999999',
            'contact:whatsapp': '+5511999999999',
            'addr:street': 'Rua Teste',
            'addr:housenumber': '10',
          },
        },
      ],
    }),
  });
  const claims = await Promise.all([processNextJob(db, overpass), processNextJob(db, overpass)]);
  assert.deepEqual(claims.sort(), [false, true]);
  assert.equal((await db.select({ value: count() }).from(leads))[0]?.value, 1);
  const lead = (await db.select().from(leads).limit(1))[0]!;
  const audit = { actor: 'integration-test', source: 'test', reason: 'phase-1 validation' };
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/leads/${lead.id}/qualification`,
        payload: { ...audit, status: 'SEM_SITE_CONFIRMADO' },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/leads/${lead.id}/qualification`,
        payload: { ...audit, status: 'VALIDANDO' },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/leads/${lead.id}/qualification`,
        payload: { ...audit, status: 'SEM_SITE_CONFIRMADO' },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await listOutreachEligibleLeads(db)).length,
    0,
    'confirmed lead without verified contact must be blocked',
  );
  const contactPayload = {
    ...audit,
    type: 'TELEFONE',
    value: '(11) 99999-1234',
    confidence: 0.95,
    verifiedAt: new Date().toISOString(),
    isValid: true,
    possibleWhatsapp: true,
  };
  const concurrentContacts = await Promise.all([
    app.inject({ method: 'PUT', url: `/leads/${lead.id}/contacts`, payload: contactPayload }),
    app.inject({ method: 'PUT', url: `/leads/${lead.id}/contacts`, payload: contactPayload }),
  ]);
  assert.deepEqual(
    concurrentContacts.map((response) => response.statusCode),
    [200, 200],
  );
  assert.equal((await db.select({ value: count() }).from(leadContacts))[0]?.value, 1);
  assert.equal((await listOutreachEligibleLeads(db)).length, 1);
  const evidencePayload = {
    ...audit,
    reference: 'https://example.test/business',
    result: 'no-site',
    confidence: 0.9,
    observedAt: new Date().toISOString(),
    notes: 'deterministic evidence',
  };
  await Promise.all([
    app.inject({ method: 'POST', url: `/leads/${lead.id}/evidence`, payload: evidencePayload }),
    app.inject({ method: 'POST', url: `/leads/${lead.id}/evidence`, payload: evidencePayload }),
  ]);
  assert.equal((await db.select({ value: count() }).from(leadEvidence))[0]?.value, 1);
  assert.ok((await db.select({ value: count() }).from(leadQualificationHistory))[0]!.value >= 5);
  const secondLead = (
    await db
      .insert(leads)
      .values({
        osmType: 'node',
        osmId: 'dedup-2',
        category: 'oficinas',
        score: 10,
        status: 'PENDENTE_VALIDACAO',
      })
      .returning()
  )[0]!;
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/leads/${secondLead.id}/contacts`,
        payload: contactPayload,
      })
    ).statusCode,
    409,
    'verified phone must not identify two leads',
  );
  await db.delete(leads).where(eq(leads.id, secondLead.id));
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/leads/${lead.id}/qualification`,
        payload: { ...audit, status: 'DESCARTADO', doNotContact: true },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await listOutreachEligibleLeads(db)).length,
    0,
    'discarded/no-contact lead must never be selected',
  );
  assert.equal(
    (await db.select().from(collectionJobs).where(eq(collectionJobs.status, 'COMPLETED'))).length,
    1,
  );

  await enqueueCollection(db, payload);
  responses.push({
    status: 200,
    body: JSON.stringify({ elements: [{ type: 'node', id: 1001, tags: { name: 'duplicate' } }] }),
  });
  assert.equal(await processNextJob(db, overpass), true);
  assert.equal((await db.select({ value: count() }).from(leads))[0]?.value, 1);

  await enqueueCollection(db, payload);
  responses.push({ status: 200, body: '{invalid-json' });
  assert.equal(await processNextJob(db, overpass), true);
  assert.equal(
    (await db.select().from(collectionJobs).where(eq(collectionJobs.status, 'FAILED'))).length,
    1,
  );
  await enqueueCollection(db, payload);
  responses.push({ status: 200, body: JSON.stringify({ elements: [] }) });
  assert.equal(await processNextJob(db, overpass), true);

  const csv = await app.inject({ method: 'GET', url: '/leads/export.csv' });
  assert.equal(csv.statusCode, 200);
  assert.match(csv.headers['content-type'] ?? '', /text\/csv; charset=utf-8/);
  assert.equal(csv.headers['content-disposition'], 'attachment; filename="leads.csv"');
  assert.match(csv.body, /"'=Oficina, ""São José""\nCentro"/);
  console.log(
    'Integration evidence: ready=200, concurrentClaims=1, qualificationTransitions=validated, contacts=deduplicated, evidence=idempotent, audit=recorded, outreach=blocked, csvInjection=neutralized',
  );
} finally {
  await app.close();
  server.close();
  await close();
}
