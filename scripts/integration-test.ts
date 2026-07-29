import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import type { InjectOptions } from 'light-my-request';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { count, eq, sql } from 'drizzle-orm';
import {
  collectionJobs,
  addNote,
  createOpportunity,
  createTask,
  createDatabase,
  crmIdempotencyKeys,
  crmNotes,
  crmTimelineEvents,
  crmTasks,
  enqueueCollection,
  leadContacts,
  leadEvidence,
  leadQualificationHistory,
  leads,
  listOutreachEligibleLeads,
} from '@lead-finder/database';
import { OverpassClient } from '@lead-finder/overpass-client';
import { buildApp } from '../apps/api/src/app.js';
import { findForbiddenPiiResponseKeys } from '../apps/api/src/api-contracts.js';
import { permissions } from '../apps/api/src/auth.js';
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
const apiAuthToken = 'synthetic-api-token-for-integration-0001';
const authenticatedPrincipalId = 'integration-principal';
const app = buildApp(db, {
  dailyLeadLimit: 5,
  collectionEgressEnabled: true,
  authentication: { token: apiAuthToken, principalId: authenticatedPrincipalId, principalPermissions: permissions },
});
const inject = (options: InjectOptions) => app.inject({
  ...options,
  headers: { ...options.headers, authorization: `Bearer ${apiAuthToken}` },
});

try {
  await db.execute(sql`
    truncate table
      deployment_daily_lead_allocations,
      deployment_daily_lead_counters,
      batch_invocations,
      processor_leadership_audit,
      processor_leadership,
      pilot_manual_message_events,
      pilot_manual_message_preparations,
      contact_email_business_evidence,
      contact_channel_authorization_revocations,
      contact_channel_authorizations,
      pilot_timeline_events,
      pilot_idempotency_keys,
      pilot_results,
      pilot_manual_contacts,
      pilot_reviews,
      pilot_leads,
      pilot_runs,
      campaign_dead_letter_recoveries,
      campaign_simulated_confirmations,
      campaign_execution_starts,
      campaign_channel_runtime,
      campaign_daily_channel_counters,
      campaign_provider_events,
      campaign_dead_letters,
      campaign_attempts,
      campaign_outbox,
      campaign_recipients,
      campaign_opt_outs,
      campaign_templates,
      campaign_versions,
      campaigns,
      crm_timeline_events,
      crm_idempotency_keys,
      crm_lead_tags,
      crm_notes,
      crm_tasks,
      crm_opportunities,
      crm_tags,
      lead_evidence,
      lead_contacts,
      lead_qualification_history,
      collection_jobs,
      leads
    restart identity
  `);
  const ready = await inject({ method: 'GET', url: '/health/ready' });
  assert.equal(ready.statusCode, 200);

  const disabledApp = buildApp(db, {
    collectionEgressEnabled: false,
    authentication: { token: apiAuthToken, principalId: authenticatedPrincipalId, principalPermissions: permissions },
  });
  const collectionCountBeforeBlockedRequest = (await db.select({ value: count() }).from(collectionJobs))[0]?.value;
  const blockedCollection = await disabledApp.inject({
    method: 'POST',
    url: '/collect',
    headers: { authorization: `Bearer ${apiAuthToken}` },
    payload: { category: 'synthetic', city: 'Test' },
  });
  assert.equal(blockedCollection.statusCode, 503);
  assert.equal(blockedCollection.json().code, 'COLLECTION_EGRESS_DISABLED');
  assert.equal(
    (await db.select({ value: count() }).from(collectionJobs))[0]?.value,
    collectionCountBeforeBlockedRequest,
    'disabled collection must not persist a job',
  );
  await disabledApp.close();

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
    assert.equal((await inject({ method: 'GET', url })).statusCode, expected, url);
  assert.equal((await inject({ method: 'POST', url: '/collect' })).statusCode, 400);
  assert.equal(
    (
      await inject({
        method: 'POST',
        url: '/collect',
        payload: { category: 'oficinas', query: '[out:json]' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await inject({
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
  const accepted = await inject({ method: 'POST', url: '/collect', payload });
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
  assert.equal(
    (await db.select({ value: count() }).from(leads).where(eq(leads.osmId, '1001')))[0]?.value,
    1,
  );
  const lead = (await db.select().from(leads).limit(1))[0]!;
  const audit = { actor: 'integration-test', source: 'test', reason: 'phase-1 validation' };
  assert.equal(
    (
      await inject({
        method: 'PATCH',
        url: `/leads/${lead.id}/qualification`,
        payload: { ...audit, status: 'SEM_SITE_CONFIRMADO' },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await inject({
        method: 'PATCH',
        url: `/leads/${lead.id}/qualification`,
        payload: { ...audit, status: 'VALIDANDO' },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await inject({
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
    verifiedAt: '2026-07-11T12:00:00.000Z',
    isValid: true,
    possibleWhatsapp: true,
  };
  const concurrentContacts = await Promise.all([
    inject({ method: 'PUT', url: `/leads/${lead.id}/contacts`, payload: contactPayload }),
    inject({ method: 'PUT', url: `/leads/${lead.id}/contacts`, payload: contactPayload }),
  ]);
  assert.deepEqual(
    concurrentContacts.map((response) => response.statusCode),
    [200, 200],
  );
  assert.equal((await db.select({ value: count() }).from(leadContacts))[0]?.value, 1);
  assert.equal((await listOutreachEligibleLeads(db)).length, 1);

  const actor = 'crm-integration';
  const opportunityPayload = {
    title: 'Website rebuild',
    value: '12500.00',
    expectedCloseAt: '2026-07-31T18:00:00Z',
    owner: actor,
    actor,
    idempotencyKey: 'opportunity-create-001',
  };
  const opportunityCreated = await inject({
    method: 'POST', url: `/leads/${lead.id}/opportunities`, payload: opportunityPayload,
  });
  const opportunityReplay = await inject({
    method: 'POST', url: `/leads/${lead.id}/opportunities`, payload: opportunityPayload,
  });
  assert.equal(opportunityCreated.statusCode, 201);
  assert.equal(opportunityReplay.statusCode, 200);
  const opportunity = opportunityCreated.json<{ id: string; version: number }>();
  assert.equal(opportunityReplay.json<{ id: string }>().id, opportunity.id);
  assert.equal((await inject({
    method: 'POST', url: `/leads/${lead.id}/opportunities`,
    payload: { ...opportunityPayload, title: 'Conflicting retry' },
  })).statusCode, 409);

  const stageBase = { actor, expectedVersion: 1, idempotencyKey: 'stage-transition-001' };
  const concurrentStages = await Promise.all([
    inject({ method: 'PATCH', url: `/leads/${lead.id}/crm/stage`, payload: { ...stageBase, stage: 'EM_VALIDACAO' } }),
    inject({ method: 'PATCH', url: `/leads/${lead.id}/crm/stage`, payload: { ...stageBase, idempotencyKey: 'stage-transition-002', stage: 'EM_VALIDACAO' } }),
  ]);
  assert.deepEqual(concurrentStages.map((response) => response.statusCode).sort(), [200, 409]);
  const legacyKey = 'stage-legacy-replay-001';
  const legacyPayload = {
    actor: authenticatedPrincipalId,
    idempotencyKey: legacyKey,
    expectedVersion: 1,
    stage: 'EM_VALIDACAO',
    action: 'TRANSITION',
  };
  const stageResult = (await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1))[0]!;
  const legacyFingerprint = createHash('sha256').update(JSON.stringify(legacyPayload)).digest('hex');
  await db.insert(crmIdempotencyKeys).values({
    scope: `lead:${lead.id}:stage`, idempotencyKey: legacyKey,
    payloadFingerprint: legacyFingerprint, resourceType: 'lead', resourceId: lead.id, result: stageResult,
  });
  const timelineBeforeLegacyReplay = (await db.select({ value: count() }).from(crmTimelineEvents))[0]!.value;
  const legacyReplay = await inject({
    method: 'PATCH', url: `/leads/${lead.id}/crm/stage`, payload: legacyPayload,
  });
  assert.equal(legacyReplay.statusCode, 200);
  assert.equal(legacyReplay.json<{ crmVersion: number }>().crmVersion, stageResult.crmVersion);
  assert.equal((await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1))[0]!.crmVersion, stageResult.crmVersion);
  assert.equal((await db.select({ value: count() }).from(crmTimelineEvents))[0]!.value, timelineBeforeLegacyReplay);
  for (const divergentPayload of [
    { ...legacyPayload, stage: 'NAO_CONTATAR', reason: 'Different stage' },
    { ...legacyPayload, action: 'REOPEN', stage: 'QUALIFICADO', reason: 'Different action' },
    { ...legacyPayload, reason: 'Different reason' },
    { ...legacyPayload, expectedVersion: 2 },
    { ...legacyPayload, actor: 'different-principal' },
    { ...legacyPayload, auditMetadata: { source: 'different' } },
  ]) assert.equal((await inject({
    method: 'PATCH', url: `/leads/${lead.id}/crm/stage`, payload: divergentPayload,
  })).statusCode, 409);
  assert.equal((await inject({
    method: 'PATCH', url: `/leads/${lead.id}/crm/stage`,
    payload: { actor, expectedVersion: 2, idempotencyKey: 'stage-invalid-001', stage: 'GANHO' },
  })).statusCode, 422);

  const won = await inject({ method: 'PATCH', url: `/opportunities/${opportunity.id}`, payload: {
    actor, expectedVersion: opportunity.version, idempotencyKey: 'opportunity-win-001', status: 'GANHA',
  } });
  assert.equal(won.statusCode, 200);
  assert.ok(won.json<{ closedAt: string | null }>().closedAt);
  assert.equal((await inject({ method: 'PATCH', url: `/opportunities/${opportunity.id}`, payload: {
    actor, expectedVersion: opportunity.version + 1, idempotencyKey: 'opportunity-loss-missing', status: 'PERDIDA',
  } })).statusCode, 400);
  const lost = await inject({ method: 'PATCH', url: `/opportunities/${opportunity.id}`, payload: {
    actor, expectedVersion: opportunity.version + 1, idempotencyKey: 'opportunity-loss-001', status: 'PERDIDA', lossReason: 'Budget deferred',
  } });
  assert.equal(lost.statusCode, 200);
  const lostResponse = lost.json<Record<string, unknown>>();
  assert.equal(Object.hasOwn(lostResponse, 'lossReason'), false);
  assert.ok(lostResponse['closedAt']);
  const canonicalLossReason = await db.execute<{ loss_reason: string | null }>(
    sql`select loss_reason from crm_opportunities where id = ${opportunity.id}::uuid`,
  );
  assert.equal(canonicalLossReason[0]?.loss_reason, 'Budget deferred');

  const notePayload = { body: 'Discovery completed', opportunityId: opportunity.id, actor, idempotencyKey: 'note-create-0001' };
  assert.equal((await inject({ method: 'POST', url: `/leads/${lead.id}/notes`, payload: notePayload })).statusCode, 201);
  assert.equal((await inject({ method: 'POST', url: `/leads/${lead.id}/notes`, payload: notePayload })).statusCode, 200);
  assert.equal((await inject({ method: 'POST', url: `/leads/${lead.id}/notes`, payload: { ...notePayload, body: 'Changed retry' } })).statusCode, 409);

  const taskPayload = {
    title: 'Overdue follow-up', dueAt: '2026-07-11T09:59:59Z', priority: 'ALTA',
    assignee: actor, opportunityId: opportunity.id, actor, idempotencyKey: 'task-create-0001',
  };
  const taskCreated = await inject({ method: 'POST', url: `/leads/${lead.id}/tasks`, payload: taskPayload });
  const taskReplay = await inject({ method: 'POST', url: `/leads/${lead.id}/tasks`, payload: taskPayload });
  assert.equal(taskCreated.statusCode, 201);
  assert.equal(taskReplay.statusCode, 200);
  const task = taskCreated.json<{ id: string; version: number }>();
  assert.equal(taskReplay.json<{ id: string }>().id, task.id);
  assert.equal((await inject({ method: 'GET', url: '/crm/tasks/overdue?to=2026-07-11T10:00:00Z' })).json<unknown[]>().length, 1);
  assert.equal((await inject({ method: 'GET', url: '/crm/tasks/overdue?to=2026-07-11T09:59:59Z' })).json<unknown[]>().length, 0);
  assert.equal((await inject({
    method: 'PATCH', url: `/tasks/${task.id}/reschedule`,
    payload: { actor, expectedVersion: task.version, idempotencyKey: 'task-reschedule-001', dueAt: '2026-07-11T10:30:00Z', reason: 'Customer request' },
  })).statusCode, 200);
  assert.equal((await inject({ method: 'GET', url: '/crm/follow-ups/upcoming?from=2026-07-11T10:00:00Z&to=2026-07-11T10:30:00Z' })).json<unknown[]>().length, 1);
  assert.equal((await inject({
    method: 'PATCH', url: `/tasks/${task.id}/complete`,
    payload: { actor, expectedVersion: task.version + 1, idempotencyKey: 'task-complete-0001', completedAt: '2026-07-11T10:15:00Z' },
  })).statusCode, 200);
  assert.equal((await inject({ method: 'GET', url: '/crm/follow-ups/upcoming?from=2026-07-11T10:00:00Z&to=2026-07-11T11:00:00Z' })).json<unknown[]>().length, 0);

  const tagBody = { actor, idempotencyKey: 'tag-add-0000001' };
  assert.equal((await inject({ method: 'PUT', url: `/leads/${lead.id}/tags/priority`, payload: tagBody })).statusCode, 200);
  assert.equal((await inject({ method: 'PUT', url: `/leads/${lead.id}/tags/priority`, payload: tagBody })).statusCode, 200);
  assert.equal((await inject({ method: 'PUT', url: `/leads/${lead.id}/tags/different`, payload: tagBody })).statusCode, 409);
  assert.equal((await inject({ method: 'PUT', url: `/leads/${lead.id}/tags/priority`, payload: { ...tagBody, idempotencyKey: 'tag-add-0000002' } })).statusCode, 200);
  assert.equal((await inject({ method: 'PUT', url: `/leads/${lead.id}/tags/priority`, payload: { ...tagBody, idempotencyKey: 'tag-add-0000002' } })).statusCode, 200);
  assert.equal((await inject({ method: 'GET', url: `/leads/${lead.id}/tags` })).json<{ items: unknown[] }>().items.length, 1);
  const removeTagBody = { actor, idempotencyKey: 'tag-remove-00001' };
  assert.equal((await inject({ method: 'DELETE', url: `/leads/${lead.id}/tags/priority`, payload: removeTagBody })).statusCode, 200);
  assert.equal((await inject({ method: 'DELETE', url: `/leads/${lead.id}/tags/priority`, payload: removeTagBody })).statusCode, 200);
  const beforeAbsentTag = (await db.select({ value: count() }).from(crmTimelineEvents))[0]!.value;
  assert.equal((await inject({ method: 'DELETE', url: `/leads/${lead.id}/tags/absent`, payload: { actor, idempotencyKey: 'tag-remove-absent' } })).statusCode, 404);
  assert.equal((await db.select({ value: count() }).from(crmTimelineEvents))[0]!.value, beforeAbsentTag);

  assert.equal((await inject({
    method: 'PATCH', url: `/leads/${lead.id}/crm/stage`,
    payload: { actor, expectedVersion: 2, idempotencyKey: 'stage-no-contact-001', stage: 'NAO_CONTATAR', reason: 'Explicit opt-out' },
  })).statusCode, 200);
  assert.equal((await listOutreachEligibleLeads(db)).length, 0);
  assert.equal((await inject({
    method: 'PATCH', url: `/leads/${lead.id}/crm/stage`,
    payload: { actor, expectedVersion: 3, idempotencyKey: 'stage-no-contact-exit-bad', stage: 'NOVO' },
  })).statusCode, 422);
  assert.equal((await inject({
    method: 'PATCH', url: `/leads/${lead.id}/crm/stage`,
    payload: { actor: 'forged-client', expectedVersion: 3, idempotencyKey: 'stage-no-contact-exit-ok', stage: 'NOVO', action: 'REACTIVATE', reason: 'Consent restored', auditMetadata: { principalId: 'forged-client', timestamp: '2000-01-01T00:00:00Z' } },
  })).statusCode, 200);
  assert.equal((await inject({
    method: 'PATCH', url: `/leads/${lead.id}/crm/stage`,
    payload: { actor: 'different-forged-client', expectedVersion: 3, idempotencyKey: 'stage-no-contact-exit-ok', stage: 'NOVO', action: 'REACTIVATE', reason: 'Consent restored', auditMetadata: { arbitrary: true } },
  })).statusCode, 200);
  type SafeTimelineEvent = {
    id: string;
    leadId: string;
    opportunityId: string | null;
    taskId: string | null;
    eventType: string;
    actor: string;
    createdAt: string;
  };
  type TimelinePage = {
    items: SafeTimelineEvent[];
    pagination: { page: number; pageSize: number; hasMore: boolean };
  };
  const timelineResponse = await inject({ method: 'GET', url: `/leads/${lead.id}/timeline?page=1&pageSize=100` });
  assert.equal(timelineResponse.statusCode, 200);
  const timelinePage = timelineResponse.json<TimelinePage>();
  const timeline = timelinePage.items;
  assert.deepEqual(timelinePage.pagination, { page: 1, pageSize: 100, hasMore: false });
  assert.ok(timeline.length >= 9);
  assert.equal(new Set(timeline.map((item) => item.id)).size, timeline.length, 'timeline must not duplicate events on retries');
  assert.equal(timeline.filter((item) => item.eventType === 'TAG_ADDED').length, 1, 'tag retry must not duplicate TAG_ADDED');
  assert.equal(timeline.filter((item) => item.eventType === 'TAG_REMOVED').length, 1, 'tag retry must not duplicate TAG_REMOVED');
  for (let index = 1; index < timeline.length; index += 1)
    assert.ok(timeline[index - 1]!.createdAt >= timeline[index]!.createdAt, 'timeline must be newest-first');
  assert.ok(timeline.some((item) => item.eventType === 'STAGE_CHANGED'));
  assert.ok(timeline.every((item) => item.actor.length > 0), 'timeline actors must be safe non-empty identifiers');
  for (const item of timeline) {
    for (const key of ['reason', 'previousValue', 'newValue', 'metadata'])
      assert.equal(Object.hasOwn(item, key), false, `HTTP timeline must omit ${key}`);
  }
  assert.deepEqual(findForbiddenPiiResponseKeys(timelinePage), []);
  const serializedTimeline = timelineResponse.body;
  for (const canary of ['+5511999999999', 'Rua Teste', '-22.9', '-47.1'])
    assert.equal(serializedTimeline.includes(canary), false, 'HTTP timeline must omit PII canaries');

  const firstTimelinePage = (await inject({
    method: 'GET', url: `/leads/${lead.id}/timeline?page=1&pageSize=5`,
  })).json<TimelinePage>();
  const secondTimelinePage = (await inject({
    method: 'GET', url: `/leads/${lead.id}/timeline?page=2&pageSize=5`,
  })).json<TimelinePage>();
  assert.deepEqual(firstTimelinePage.pagination, { page: 1, pageSize: 5, hasMore: true });
  assert.deepEqual(secondTimelinePage.pagination, { page: 2, pageSize: 5, hasMore: timeline.length >= 10 });
  assert.deepEqual(firstTimelinePage.items, timeline.slice(0, 5));
  assert.deepEqual(secondTimelinePage.items, timeline.slice(5, 10));
  assert.equal(
    new Set([...firstTimelinePage.items, ...secondTimelinePage.items].map((item) => item.id)).size,
    firstTimelinePage.items.length + secondTimelinePage.items.length,
    'timeline pages must not overlap',
  );

  const persistedTimeline = await db.select().from(crmTimelineEvents).where(eq(crmTimelineEvents.leadId, lead.id));
  const reactivationEvent = persistedTimeline.find((item) => {
    const metadata = item.metadata as Record<string, unknown>;
    return item.eventType === 'STAGE_CHANGED' && metadata['action'] === 'REACTIVATE';
  });
  assert.ok(reactivationEvent, 'persisted REACTIVATE audit event must exist');
  const reactivationMetadata = reactivationEvent.metadata as Record<string, unknown>;
  assert.equal(reactivationEvent.actor, authenticatedPrincipalId, 'reactivation actor must come from the authenticated principal');
  assert.equal(Object.hasOwn(reactivationMetadata, 'principalId'), false, 'reactivation metadata must omit principalId');
  assert.equal(reactivationMetadata['authenticationMethod'], 'BEARER_TOKEN');
  assert.equal(reactivationMetadata['source'], 'authenticated-api');
  assert.match(String(reactivationMetadata['timestamp']), /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.notEqual(reactivationMetadata['timestamp'], '2000-01-01T00:00:00Z');

  const otherLead = (await db.insert(leads).values({
    osmType: 'node', osmId: 'cross-resource-lead', category: 'oficinas', score: 10,
    status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO',
  }).returning())[0]!;
  const otherOpportunity = (await createOpportunity(db, otherLead.id, {
    title: 'Other lead opportunity', value: '10.00', actor, idempotencyKey: 'other-opportunity-001',
  })).data;
  const notesBeforeCrossLead = (await db.select({ value: count() }).from(crmNotes))[0]!.value;
  const timelineBeforeCrossLead = (await db.select({ value: count() }).from(crmTimelineEvents))[0]!.value;
  await assert.rejects(addNote(db, lead.id, {
    body: 'Must roll back', opportunityId: otherOpportunity.id, actor, idempotencyKey: 'cross-note-000001',
  }));
  await assert.rejects(createTask(db, lead.id, {
    title: 'Must roll back', dueAt: '2026-07-11T12:00:00Z', opportunityId: otherOpportunity.id,
    actor, idempotencyKey: 'cross-task-000001',
  }));
  assert.equal((await db.select({ value: count() }).from(crmNotes))[0]!.value, notesBeforeCrossLead);
  assert.equal((await db.select({ value: count() }).from(crmTimelineEvents))[0]!.value, timelineBeforeCrossLead);
  const excludedLeads = await db.insert(leads).values([
    { osmType: 'node', osmId: 'blocked-crm', category: 'oficinas', score: 10, status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO', isBlocked: true },
    { osmType: 'node', osmId: 'dnc-crm', category: 'oficinas', score: 10, status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NOVO', doNotContact: true },
    { osmType: 'node', osmId: 'incompatible-crm', category: 'oficinas', score: 10, status: 'PENDENTE_VALIDACAO', qualificationStatus: 'PENDENTE', crmStage: 'NOVO' },
    { osmType: 'node', osmId: 'stage-dnc-crm', category: 'oficinas', score: 10, status: 'SEM_SITE_CADASTRADO', qualificationStatus: 'SEM_SITE_CONFIRMADO', crmStage: 'NAO_CONTATAR' },
  ]).returning();
  await db.insert(crmTasks).values(excludedLeads.map((excluded, index) => ({
    leadId: excluded.id, title: `Excluded ${index}`, dueAt: new Date('2026-07-11T09:00:00Z'), owner: actor,
  })));
  assert.equal((await inject({ method: 'GET', url: '/crm/tasks/overdue?to=2026-07-11T10:00:00Z' })).json<unknown[]>().length, 0,
    'blocked, do-not-contact, incompatible, and NAO_CONTATAR leads must be absent from queues');
  assert.equal((await listOutreachEligibleLeads(db)).some((candidate) => excludedLeads.some((excluded) => excluded.id === candidate.id)), false);
  for (const excluded of excludedLeads) await db.delete(leads).where(eq(leads.id, excluded.id));

  const evidencePayload = {
    ...audit,
    reference: 'https://example.test/business',
    result: 'no-site',
    confidence: 0.9,
    observedAt: '2026-07-11T12:00:00.000Z',
    notes: 'deterministic evidence',
  };
  await Promise.all([
    inject({ method: 'POST', url: `/leads/${lead.id}/evidence`, payload: evidencePayload }),
    inject({ method: 'POST', url: `/leads/${lead.id}/evidence`, payload: evidencePayload }),
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
      await inject({
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
      await inject({
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

  await db.insert(collectionJobs).values({ payload });
  const responseCountBeforeLegacyClaim = responses.length;
  assert.equal(await processNextJob(db, overpass), false, 'historical job must remain ineligible');
  assert.equal(responses.length, responseCountBeforeLegacyClaim, 'historical job must not fetch');
  const [historicalJob] = await db.select().from(collectionJobs).where(eq(collectionJobs.status, 'PENDING'));
  assert.ok(historicalJob, 'historical job must remain pending without consuming an attempt');

  await enqueueCollection(db, payload, { enabled: true, configurationVersion: 1 });
  responses.push({
    status: 200,
    body: JSON.stringify({ elements: [{ type: 'node', id: 1001, tags: { name: 'duplicate' } }] }),
  });
  assert.equal(await processNextJob(db, overpass), true);
  assert.equal(
    (await db.select({ value: count() }).from(leads).where(eq(leads.osmId, '1001')))[0]?.value,
    1,
  );

  await enqueueCollection(db, payload, { enabled: true, configurationVersion: 1 });
  responses.push({ status: 200, body: '{invalid-json' });
  assert.equal(await processNextJob(db, overpass), true);
  assert.equal(
    (await db.select().from(collectionJobs).where(eq(collectionJobs.status, 'FAILED'))).length,
    1,
  );
  await enqueueCollection(db, payload, { enabled: true, configurationVersion: 1 });
  responses.push({ status: 200, body: JSON.stringify({ elements: [] }) });
  assert.equal(await processNextJob(db, overpass), true);

  const csv = await inject({ method: 'GET', url: '/leads/export.csv' });
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

await import('../packages/database/src/campaign.integration.js');
await import('../packages/database/src/campaign-outbox.integration.js');
await import('../packages/database/src/campaign-outbox.extreme.integration.js');
await import('../packages/database/src/campaign-outbox.endurance.integration.js');
await import('../packages/database/src/deployment-processing.integration.js');
const { runPilotPersistenceIntegration } = await import('../packages/database/src/pilot.integration.js');
await runPilotPersistenceIntegration(databaseUrl);

const pilotReportPath = process.env['PILOT_REPORT_PATH'];
if (pilotReportPath) {
  const reportDatabase = createDatabase(databaseUrl);
  try {
    const counts = (await reportDatabase.db.execute<{
      leads: number;
      completed_collection_jobs: number;
      verified_contacts: number;
      crm_timeline_events: number;
      campaigns: number;
      campaign_recipients: number;
      campaign_attempts: number;
      campaign_outbox_events: number;
    }>(sql`
      select
        (select count(*)::int from leads) as leads,
        (select count(*)::int from collection_jobs where status = 'COMPLETED') as completed_collection_jobs,
        (select count(*)::int from lead_contacts where is_valid = true and verified_at is not null) as verified_contacts,
        (select count(*)::int from crm_timeline_events) as crm_timeline_events,
        (select count(*)::int from campaigns) as campaigns,
        (select count(*)::int from campaign_recipients) as campaign_recipients,
        (select count(*)::int from campaign_attempts) as campaign_attempts,
        (select count(*)::int from campaign_outbox) as campaign_outbox_events
    `))[0]!;

    const report = {
      schemaVersion: 1,
      sha: process.env['GITHUB_SHA'] ?? 'local',
      generatedAt: new Date().toISOString(),
      result: 'PASS',
      networkMode: 'loopback-overpass-mock-only',
      counts,
      gates: {
        collectionMockAndPersistence: 'PASS',
        qualificationAndVerifiedContact: 'PASS',
        commercialBlocks: 'PASS',
        crmAndAudit: 'PASS',
        simulatedCampaign: 'PASS',
        idempotentReplay: 'PASS',
        eligibleListingAndCsv: 'PASS',
        restartWithoutDuplicates: 'PASS',
        externalSendDisabled: 'PASS',
      },
    };

    await mkdir(dirname(pilotReportPath), { recursive: true });
    await writeFile(pilotReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Pilot readiness report: ${pilotReportPath}`);
  } finally {
    await reportDatabase.close();
  }
}
