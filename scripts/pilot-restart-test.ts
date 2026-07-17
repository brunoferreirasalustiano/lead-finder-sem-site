import { strict as assert } from 'node:assert';
import type { InjectOptions } from 'light-my-request';
import { readFile, writeFile } from 'node:fs/promises';
import { count, eq } from 'drizzle-orm';
import {
  addNote,
  campaignAttempts,
  campaignOutbox,
  campaignRecipients,
  createAttemptWithOutbox,
  createDatabase,
  createOpportunity,
  createRecipientWithOutbox,
  createTask,
  crmTimelineEvents,
  leadContacts,
  leadEvidence,
  leads,
  pilotIdempotencyKeys,
  pilotRuns,
  pilotTimelineEvents,
} from '@lead-finder/database';
import { buildApp } from '../apps/api/src/app.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const { db, close } = createDatabase(databaseUrl);
const apiAuthToken = 'synthetic-api-token-for-integration-0001';
const app = buildApp(db, { dailyLeadLimit: 5, authentication: { token: apiAuthToken } });
const inject = (options: InjectOptions) => app.inject({
  ...options,
  headers: { ...options.headers, authorization: `Bearer ${apiAuthToken}` },
});

const snapshotCounts = async () => ({
  leads: (await db.select({ value: count() }).from(leads))[0]!.value,
  verifiedContacts: (await db.select({ value: count() }).from(leadContacts))[0]!.value,
  evidence: (await db.select({ value: count() }).from(leadEvidence))[0]!.value,
  crmTimelineEvents: (await db.select({ value: count() }).from(crmTimelineEvents))[0]!.value,
  campaignRecipients: (await db.select({ value: count() }).from(campaignRecipients))[0]!.value,
  campaignAttempts: (await db.select({ value: count() }).from(campaignAttempts))[0]!.value,
  campaignOutboxEvents: (await db.select({ value: count() }).from(campaignOutbox))[0]!.value,
  pilotRuns: (await db.select({ value: count() }).from(pilotRuns))[0]!.value,
  pilotTimelineEvents: (await db.select({ value: count() }).from(pilotTimelineEvents))[0]!.value,
  pilotIdempotencyKeys: (await db.select({ value: count() }).from(pilotIdempotencyKeys))[0]!.value,
});

try {
  const lead = (await db.select().from(leads).where(eq(leads.osmId, '1001')).limit(1))[0];
  assert.ok(lead, 'persisted pilot lead must exist after process restart');
  assert.equal(
    (await db.select({ value: count() }).from(leads).where(eq(leads.osmId, '1001')))[0]!.value,
    1,
    'pilot collection must remain deduplicated after restart',
  );

  const before = await snapshotCounts();
  assert.ok(before.leads > 0);
  assert.ok(before.verifiedContacts > 0);
  assert.ok(before.evidence > 0);
  assert.ok(before.crmTimelineEvents > 0);
  assert.ok(before.campaignRecipients > 0);
  assert.ok(before.campaignAttempts > 0);
  assert.ok(before.campaignOutboxEvents > 0);
  assert.ok(before.pilotRuns > 0);
  assert.ok(before.pilotTimelineEvents > 0);
  assert.ok(before.pilotIdempotencyKeys > 0);

  const actor = 'crm-integration';
  const opportunity = await createOpportunity(db, lead.id, {
    title: 'Website rebuild',
    value: '12500.00',
    expectedCloseAt: '2026-07-31T18:00:00Z',
    owner: actor,
    actor,
    idempotencyKey: 'opportunity-create-001',
  });
  assert.equal(opportunity.replayed, true);

  const note = await addNote(db, lead.id, {
    body: 'Discovery completed',
    opportunityId: opportunity.data.id,
    actor,
    idempotencyKey: 'note-create-0001',
  });
  assert.equal(note.replayed, true);

  const task = await createTask(db, lead.id, {
    title: 'Overdue follow-up',
    dueAt: '2026-07-11T09:59:59Z',
    priority: 'ALTA',
    assignee: actor,
    opportunityId: opportunity.data.id,
    actor,
    idempotencyKey: 'task-create-0001',
  });
  assert.equal(task.replayed, true);

  const contactPayload = {
    actor: 'integration-test',
    source: 'test',
    reason: 'phase-1 validation',
    type: 'TELEFONE',
    value: '(11) 99999-1234',
    confidence: 0.95,
    verifiedAt: '2026-07-11T12:00:00.000Z',
    isValid: true,
    possibleWhatsapp: true,
  };
  assert.equal((await inject({
    method: 'PUT',
    url: `/leads/${lead.id}/contacts`,
    payload: contactPayload,
  })).statusCode, 200);

  const evidencePayload = {
    actor: 'integration-test',
    source: 'test',
    reason: 'phase-1 validation',
    reference: 'https://example.test/business',
    result: 'no-site',
    confidence: 0.9,
    observedAt: '2026-07-11T12:00:00.000Z',
    notes: 'deterministic evidence',
  };
  assert.equal((await inject({
    method: 'POST',
    url: `/leads/${lead.id}/evidence`,
    payload: evidencePayload,
  })).statusCode, 201);

  const recipient = (await db.select().from(campaignRecipients))
    .find((row) => (row.recipientSnapshot as { leadName?: string }).leadName === 'Snapshot Original');
  assert.ok(recipient, 'scheduled campaign recipient must exist after restart');
  const recipientReplay = await createRecipientWithOutbox(db, {
    campaignId: recipient.campaignId,
    campaignVersionId: recipient.campaignVersionId,
    leadId: recipient.leadId,
    channel: recipient.channel,
    snapshot: { leadName: 'Snapshot Original', address: 'Rua A' },
    idempotencyKey: recipient.idempotencyKey,
    availableAt: recipient.availableAt,
  });
  assert.equal(recipientReplay.replayed, true);

  const attempt = (await db.select().from(campaignAttempts))
    .find((row) => (row.payloadSnapshot as { body?: string }).body === 'Hello');
  assert.ok(attempt, 'scheduled campaign attempt must exist after restart');
  const attemptReplay = await createAttemptWithOutbox(db, {
    recipientId: attempt.recipientId,
    payloadSnapshot: { to: 'lead@example.test', body: 'Hello' },
    idempotencyKey: attempt.idempotencyKey,
    availableAt: attempt.availableAt,
  });
  assert.equal(attemptReplay.replayed, true);

  assert.equal((await inject({ method: 'GET', url: '/leads?page=1&pageSize=20' })).statusCode, 200);
  assert.equal((await inject({ method: 'GET', url: '/leads/export.csv' })).statusCode, 200);

  const after = await snapshotCounts();
  assert.deepEqual(after, before, 'logical restart and exact replays must not duplicate persisted resources');

  const pilotReportPath = process.env['PILOT_REPORT_PATH'];
  if (pilotReportPath) {
    const report = JSON.parse(await readFile(pilotReportPath, 'utf8')) as Record<string, unknown>;
    report['restartReplay'] = { result: 'PASS', countsBefore: before, countsAfter: after };
    await writeFile(pilotReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log('Pilot restart evidence: persisted state replayed without duplicate resources');
} finally {
  await app.close();
  await close();
}
