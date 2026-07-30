import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  createDatabase,
  ManualMessagingError,
  prepareManualMessage,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const raw = postgres(databaseUrl, { max: 8 });
const inspector = postgres(databaseUrl, { max: 1 });
const { db, close } = createDatabase(databaseUrl, { max: 8 });
const primaryActor = createAuthorizationContext({
  principalId: 'manual-concurrency-operator',
  permissions: new Set(['manual-messaging:prepare']),
  authenticationMethod: 'integration-test',
});

type Fixture = {
  pilotId: string;
  leadId: string;
  emailId: string;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type ObservedResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; error: unknown };

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const observe = <T>(operation: Promise<T>): Promise<ObservedResult<T>> =>
  operation.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );

async function assertPending<T>(
  observed: Promise<ObservedResult<T>>,
  label: string,
): Promise<void> {
  const state = await Promise.race([
    observed.then(() => 'settled' as const),
    delay(40).then(() => 'pending' as const),
  ]);
  assert.equal(state, 'pending', `${label} must wait for the shared lead lock`);
}

function assertRejectedCode(
  result: ObservedResult<unknown>,
  code: ManualMessagingError['code'],
): void {
  if (result.status !== 'rejected') {
    assert.fail(`expected ${code}, but operation fulfilled`);
  }
  assert.ok(result.error instanceof ManualMessagingError);
  assert.equal(result.error.code, code);
}

let fixtureSequence = 0;
async function fixture(): Promise<Fixture> {
  fixtureSequence += 1;
  const leadId = randomUUID();
  const pilotId = randomUUID();
  const emailId = randomUUID();
  const suffix = String(fixtureSequence).padStart(4, '0');
  await raw.begin(async (tx) => {
    await tx`insert into leads(id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,do_not_contact,crm_stage)
      values(${leadId}::uuid,'node',${`concurrency-${suffix}`},'Empresa concorrente sintética','oficinas',90,'SEM_SITE_CADASTRADO',false,false,false,'NOVO')`;
    await tx`insert into pilot_runs(id,name,region,category,target_lead_count,status,created_by,started_at)
      values(${pilotId}::uuid,${`Piloto concorrente ${suffix}`},'SP','oficinas',1,'RUNNING','integration-test',now())`;
    await tx`insert into pilot_leads(pilot_run_id,lead_id,source,added_by)
      values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`insert into pilot_reviews(pilot_run_id,lead_id,decision,reviewer_principal_id,version)
      values(${pilotId}::uuid,${leadId}::uuid,'APPROVED','reviewer',1)`;
    await tx`insert into lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp)
      values(${emailId}::uuid,${leadId}::uuid,'EMAIL','synthetic-email',${`concorrencia${suffix}@company.example`},'BUSINESS_REGISTRY',1,now(),true,false)`;
    await tx`insert into contact_email_business_evidence(contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,human_decision,reviewer_principal_id,version)
      values(${emailId}::uuid,${leadId}::uuid,'EMAIL','BUSINESS','PUBLIC_BUSINESS_SOURCE',${'a'.repeat(64)},'APPROVED','email-reviewer',1)`;
  });
  return { pilotId, leadId, emailId };
}

const emailInput = (contactId: string, idempotencyKey = randomUUID()) => ({
  contactId,
  requestedChannel: 'EMAIL' as const,
  templateId: 'pilot-email-first-contact',
  templateVersion: 'v1',
  idempotencyKey,
});

async function assertLeadLockHeld(leadId: string): Promise<void> {
  const row = (
    await inspector`
      select pg_try_advisory_lock(
        hashtextextended(${'manual-messaging:' + leadId},0)
      ) acquired
    `
  )[0];
  const acquired = Boolean(row?.acquired);
  if (acquired) {
    await inspector`
      select pg_advisory_unlock(
        hashtextextended(${'manual-messaging:' + leadId},0)
      )
    `;
  }
  assert.equal(acquired, false, 'email evidence insert must hold the shared lead lock');
}

async function beginEvidenceTransaction(
  item: Fixture,
  input: {
    version: number;
    ownership: 'BUSINESS' | 'PERSONAL' | 'UNKNOWN';
    humanDecision: 'APPROVED' | 'REJECTED';
    fingerprint: string;
  },
) {
  const inserted = deferred<void>();
  const release = deferred<void>();
  const done = raw.begin(async (tx) => {
    await tx`insert into contact_email_business_evidence(contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,human_decision,reviewer_principal_id,version)
      values(${item.emailId}::uuid,${item.leadId}::uuid,'EMAIL',${input.ownership},'DIRECTLY_PROVIDED',${input.fingerprint},${input.humanDecision},'email-reviewer',${input.version})`;
    inserted.resolve(undefined);
    await release.promise;
  });
  void done.catch(inserted.reject);
  await inserted.promise;
  await assertLeadLockHeld(item.leadId);
  return {
    release: () => release.resolve(undefined),
    done,
  };
}

const count = async (table: string, where = '') =>
  Number((await raw.unsafe(`select count(*)::int value from ${table} ${where}`))[0]?.value ?? -1);

const report: string[] = [];
const pass = (name: string) => report.push(name);

try {
  const baselinePreparations = await count('pilot_manual_message_preparations');
  const baselineEvents = await count('pilot_manual_message_events');
  const baselineOutbox = await count('campaign_outbox');
  const baselineProviders = await count('campaign_provider_events');

  const unfavorableFixture = await fixture();
  const unfavorableEvidence = await beginEvidenceTransaction(unfavorableFixture, {
    version: 2,
    ownership: 'PERSONAL',
    humanDecision: 'APPROVED',
    fingerprint: 'b'.repeat(64),
  });
  const unfavorableObserved = observe(
    prepareManualMessage(
      db,
      unfavorableFixture.pilotId,
      unfavorableFixture.leadId,
      emailInput(unfavorableFixture.emailId),
      primaryActor,
    ),
  );
  await assertPending(unfavorableObserved, 'ineligible email preparation');
  unfavorableEvidence.release();
  await unfavorableEvidence.done;
  assertRejectedCode(await unfavorableObserved, 'INELIGIBLE');
  assert.equal(await count('pilot_manual_message_preparations'), baselinePreparations);
  assert.equal(await count('pilot_manual_message_events'), baselineEvents);
  assert.equal(await count('campaign_outbox'), baselineOutbox);
  assert.equal(await count('campaign_provider_events'), baselineProviders);
  pass('concurrent unfavorable evidence wins before email fail-closed evaluation');

  const favorableFixture = await fixture();
  const favorableEvidence = await beginEvidenceTransaction(favorableFixture, {
    version: 2,
    ownership: 'BUSINESS',
    humanDecision: 'APPROVED',
    fingerprint: 'c'.repeat(64),
  });
  const favorableObserved = observe(
    prepareManualMessage(
      db,
      favorableFixture.pilotId,
      favorableFixture.leadId,
      emailInput(favorableFixture.emailId),
      primaryActor,
    ),
  );
  await assertPending(favorableObserved, 'eligible email preparation');
  favorableEvidence.release();
  await favorableEvidence.done;
  assertRejectedCode(await favorableObserved, 'EMAIL_CONSUMER_UNAVAILABLE');
  assert.equal(await count('pilot_manual_message_preparations'), baselinePreparations);
  assert.equal(await count('pilot_manual_message_events'), baselineEvents);
  assert.equal(await count('campaign_outbox'), baselineOutbox);
  assert.equal(await count('campaign_provider_events'), baselineProviders);
  pass('concurrent favorable evidence reaches stable email fail-closed result without persistence');

  const sequenceFixture = await fixture();
  const versionTwo = await beginEvidenceTransaction(sequenceFixture, {
    version: 2,
    ownership: 'BUSINESS',
    humanDecision: 'APPROVED',
    fingerprint: 'd'.repeat(64),
  });
  const versionThreeObserved = observe(
    raw.begin(async (tx) => {
      await tx`insert into contact_email_business_evidence(contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,human_decision,reviewer_principal_id,version)
        values(${sequenceFixture.emailId}::uuid,${sequenceFixture.leadId}::uuid,'EMAIL','BUSINESS','SIGNED_RECORD',${'e'.repeat(64)},'APPROVED','email-reviewer',3)`;
    }),
  );
  await assertPending(versionThreeObserved, 'next email evidence version');
  versionTwo.release();
  await versionTwo.done;
  const versionThreeResult = await versionThreeObserved;
  assert.equal(versionThreeResult.status, 'fulfilled');
  const versions = await raw`
    select version
    from contact_email_business_evidence
    where contact_id=${sequenceFixture.emailId}::uuid
    order by version
  `;
  assert.deepEqual(
    versions.map((row) => Number(row.version)),
    [1, 2, 3],
  );
  pass('concurrent favorable evidence preserves sequential versions without deadlock');

  assert.equal(await count('campaign_provider_events'), baselineProviders);
  console.log(
    JSON.stringify({
      result: 'MANUAL_MESSAGING_CONCURRENCY_POSTGRES_PASS',
      tests: report,
      networkCalls: 0,
    }),
  );
} finally {
  await close();
  await inspector.end();
  await raw.end();
}
