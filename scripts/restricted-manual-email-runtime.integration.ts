import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import {
  createDatabase,
  prepareManualMessage,
  recordManualOpen,
  sendPreparedManualEmail,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';

const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required');

const roleName = 'lead_finder_api_runtime';
const rolePassword = 'synthetic-restricted-email-role-password-0001';
const owner = postgres(sourceUrl, { max: 4 });
const createSql = await readFile(
  new URL('../database/security/create_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const hmlSupplementSql = await readFile(
  new URL('../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
);
const rollbackSql = await readFile(
  new URL('../database/security/rollback_lead_finder_api_runtime.sql', import.meta.url),
  'utf8',
);
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
const expectSqlState = (expectedCode: string) => (error: unknown) => {
  const candidate = error as { code?: unknown };
  assert.equal(candidate.code, expectedCode);
  return true;
};

const leadId = randomUUID();
const pilotId = randomUUID();
const contactId = randomUUID();
const principalId = 'restricted-email-runtime-operator';
const idempotencyKey = randomUUID();
const auth = createAuthorizationContext({
  principalId,
  permissions: new Set([
    'manual-messaging:prepare',
    'manual-messaging:open',
    'manual-messaging:send',
  ]),
  authenticationMethod: 'integration-test',
});
const roleUrl = new URL(sourceUrl);
roleUrl.username = roleName;
roleUrl.password = rolePassword;

let restrictedRaw: ReturnType<typeof postgres> | undefined;
let closeRestricted: (() => Promise<void>) | undefined;
let providerCalls = 0;

const cleanupFixture = async () => {
  await owner`
    delete from pilot_manual_email_send_events
    where attempt_id in (
      select id from pilot_manual_email_send_attempts where pilot_run_id=${pilotId}::uuid
    )`;
  await owner`
    delete from pilot_manual_email_send_attempts where pilot_run_id=${pilotId}::uuid`;
  await owner`
    delete from pilot_manual_message_events
    where preparation_id in (
      select id from pilot_manual_message_preparations where pilot_run_id=${pilotId}::uuid
    )`;
  await owner`
    delete from pilot_manual_message_preparations where pilot_run_id=${pilotId}::uuid`;
  await owner`
    delete from contact_email_business_evidence
    where contact_id=${contactId}::uuid and lead_id=${leadId}::uuid`;
  await owner`delete from pilot_reviews where pilot_run_id=${pilotId}::uuid`;
  await owner`delete from pilot_leads where pilot_run_id=${pilotId}::uuid`;
  await owner`delete from pilot_runs where id=${pilotId}::uuid`;
  await owner`delete from lead_contacts where id=${contactId}::uuid`;
  await owner`delete from leads where id=${leadId}::uuid`;
};

try {
  await owner.unsafe(rollbackSql).catch(() => undefined);
  await owner.unsafe(createSql);
  await owner.unsafe(hmlSupplementSql);
  await owner.unsafe(hmlSupplementSql);
  await owner.unsafe(`ALTER ROLE ${roleName} PASSWORD ${quoteLiteral(rolePassword)}`);

  const attributes = (await owner<{
    login: boolean;
    inherit: boolean;
    superuser: boolean;
    createDb: boolean;
    createRole: boolean;
    bypassRls: boolean;
  }[]>`
    select
      rolcanlogin as login,
      rolinherit as inherit,
      rolsuper as superuser,
      rolcreatedb as "createDb",
      rolcreaterole as "createRole",
      rolbypassrls as "bypassRls"
    from pg_roles where rolname=${roleName}`)[0];
  assert.deepEqual(attributes, {
    login: true,
    inherit: false,
    superuser: false,
    createDb: false,
    createRole: false,
    bypassRls: false,
  });

  const emailFunctionPrivileges = await owner<{
    identity: string;
    executable: boolean;
  }[]>`
    select procedure_record.oid::regprocedure::text as identity,
      has_function_privilege(${roleName}, procedure_record.oid, 'EXECUTE') as executable
    from pg_proc procedure_record
    join pg_namespace namespace_record
      on namespace_record.oid=procedure_record.pronamespace
    where namespace_record.nspname='public'
      and procedure_record.proname in (
        'resolve_manual_email_contact_context',
        'create_manual_email_preparation',
        'resolve_manual_email_preparation_context',
        'append_manual_email_open_event',
        'create_manual_email_send_attempt',
        'append_manual_email_send_event'
      )
    order by identity`;
  assert.equal(emailFunctionPrivileges.length, 6);
  assert.equal(emailFunctionPrivileges.every(({ executable }) => executable), true);

  for (const table of [
    'lead_contacts',
    'pilot_manual_message_preparations',
    'pilot_manual_message_events',
    'pilot_manual_email_send_attempts',
    'pilot_manual_email_send_events',
  ]) {
    const privileges = (await owner<{
      canSelect: boolean;
      canInsert: boolean;
      canUpdate: boolean;
      canDelete: boolean;
    }[]>`
      select
        has_table_privilege(${roleName}, ${`public.${table}`}, 'SELECT') as "canSelect",
        has_table_privilege(${roleName}, ${`public.${table}`}, 'INSERT') as "canInsert",
        has_table_privilege(${roleName}, ${`public.${table}`}, 'UPDATE') as "canUpdate",
        has_table_privilege(${roleName}, ${`public.${table}`}, 'DELETE') as "canDelete"`)[0];
    assert.deepEqual(privileges, {
      canSelect: false,
      canInsert: false,
      canUpdate: false,
      canDelete: false,
    });
  }

  await owner.begin(async (tx) => {
    await tx`
      insert into leads(
        id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,
        do_not_contact,crm_stage
      ) values(
        ${leadId}::uuid,'node',${`restricted-runtime-${leadId}`},
        'Empresa sintética runtime','saloes',90,'SEM_SITE_CADASTRADO',
        false,false,false,'NOVO'
      )`;
    await tx`
      insert into pilot_runs(
        id,name,region,category,target_lead_count,status,created_by,started_at
      ) values(
        ${pilotId}::uuid,'Piloto sintético runtime','Campinas/SP','saloes',1,
        'RUNNING','integration-test',now()
      )`;
    await tx`
      insert into pilot_leads(pilot_run_id,lead_id,source,added_by)
      values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`
      insert into pilot_reviews(
        pilot_run_id,lead_id,decision,reviewer_principal_id,version
      ) values(${pilotId}::uuid,${leadId}::uuid,'APPROVED','reviewer',1)`;
    await tx`
      insert into lead_contacts(
        id,lead_id,type,original_value,normalized_value,source,confidence,
        verified_at,is_valid,possible_whatsapp
      ) values(
        ${contactId}::uuid,${leadId}::uuid,'EMAIL','synthetic-email',
        'runtime-contact@example.test','PUBLIC_BUSINESS_SOURCE',1,now(),true,false
      )`;
    await tx`
      insert into contact_email_business_evidence(
        contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,
        human_decision,reviewer_principal_id,version
      ) values(
        ${contactId}::uuid,${leadId}::uuid,'EMAIL','BUSINESS',
        'PUBLIC_BUSINESS_SOURCE',${'a'.repeat(64)},'APPROVED','reviewer',1
      )`;
  });

  restrictedRaw = postgres(roleUrl.toString(), { max: 2 });
  const restrictedDatabase = createDatabase(roleUrl.toString(), { max: 6 });
  closeRestricted = restrictedDatabase.close;
  assert.equal((await restrictedRaw<{ currentUser: string }[]>`
    select current_user as "currentUser"`)[0]?.currentUser, roleName);

  const prepared = await prepareManualMessage(
    restrictedDatabase.db,
    pilotId,
    leadId,
    {
      contactId,
      requestedChannel: 'EMAIL',
      templateId: 'pilot-email-first-contact',
      templateVersion: 'v2',
      idempotencyKey,
    },
    auth,
  );
  assert.equal(prepared.channel, 'EMAIL');
  assert.equal(prepared.templateVersion, 'v2');
  assert.equal(prepared.replayed, false);

  await recordManualOpen(
    restrictedDatabase.db,
    prepared.preparationId,
    { idempotencyKey: randomUUID() },
    auth,
  );

  const runtime = {
    sendEnabled: true,
    killSwitchEnabled: false,
    sender: 'leadfinderbrasil@example.test',
    fingerprintKey: 'restricted-runtime-email-fingerprint-key-0001',
    deliver: async (message: {
      subject: string;
      body: string;
      recipient: string;
    }) => {
      providerCalls += 1;
      assert.equal(message.recipient, 'runtime-contact@example.test');
      assert.equal(message.subject.includes('Empresa sintética runtime'), true);
      assert.equal(message.body.includes('lead-finder-demos'), true);
      return {
        provider: 'GMAIL_API' as const,
        messageId: 'synthetic-runtime-message-id',
      };
    },
  };
  const delivered = await sendPreparedManualEmail(
    restrictedDatabase.db,
    prepared.preparationId,
    auth,
    runtime,
  );
  assert.equal(delivered.state, 'DELIVERED');
  assert.equal(providerCalls, 1);

  const replay = await sendPreparedManualEmail(
    restrictedDatabase.db,
    prepared.preparationId,
    auth,
    runtime,
  );
  assert.equal(replay.state, 'DELIVERED');
  assert.equal(replay.replayed, true);
  assert.equal(providerCalls, 1);

  for (const table of [
    'lead_contacts',
    'pilot_manual_message_preparations',
    'pilot_manual_email_send_attempts',
    'pilot_manual_email_send_events',
  ]) {
    await assert.rejects(
      restrictedRaw.unsafe(`select * from public.${table} limit 1`),
      expectSqlState('42501'),
    );
  }
  await assert.rejects(
    restrictedRaw.unsafe(`
      insert into public.pilot_manual_email_send_attempts(
        preparation_id,pilot_run_id,lead_id,contact_id,operator_principal_id,
        sender_fingerprint,recipient_fingerprint,message_fingerprint,provider
      ) values(
        '${prepared.preparationId}'::uuid,'${pilotId}'::uuid,'${leadId}'::uuid,
        '${contactId}'::uuid,'${principalId}',repeat('b',64),repeat('c',64),
        repeat('d',64),'GMAIL_API'
      )`),
    expectSqlState('42501'),
  );

  const persisted = (await owner<{
    attempts: number;
    events: number;
    rawColumns: number;
  }[]>`
    select
      (select count(*)::int from pilot_manual_email_send_attempts
       where pilot_run_id=${pilotId}::uuid) as attempts,
      (select count(*)::int from pilot_manual_email_send_events event
       join pilot_manual_email_send_attempts attempt on attempt.id=event.attempt_id
       where attempt.pilot_run_id=${pilotId}::uuid) as events,
      (select count(*)::int from information_schema.columns
       where table_schema='public'
         and table_name in ('pilot_manual_email_send_attempts','pilot_manual_email_send_events')
         and column_name in ('recipient','email','subject','body','payload')) as "rawColumns"`)[0];
  assert.deepEqual(persisted, { attempts: 1, events: 1, rawColumns: 0 });

  console.log(JSON.stringify({
    result: 'RESTRICTED_MANUAL_EMAIL_RUNTIME_ROLE_PASS',
    runtimeRole: roleName,
    directEmailTableAccess: 'DENIED',
    narrowFunctionCount: 6,
    providerCalls,
    replayProviderCalls: 0,
    rawRecipientColumns: 0,
    realRecipients: 0,
    messagesSent: 0,
  }));
} finally {
  if (closeRestricted) await closeRestricted().catch(() => undefined);
  if (restrictedRaw) await restrictedRaw.end().catch(() => undefined);
  await cleanupFixture().catch(() => undefined);
  await owner.unsafe(rollbackSql).catch(() => undefined);
  await owner.end();
}
