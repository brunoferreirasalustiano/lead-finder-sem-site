import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const raw = postgres(databaseUrl, { max: 8 });
const scopeConstraint = 'pilot_manual_whatsapp_cloud_send_attempts_send_scope_key';
const fingerprint = (seed: string) => createHash('sha256').update(seed, 'utf8').digest('hex');
let fixtureSequence = 0;

type Fixture = Readonly<{
  pilotId: string;
  leadId: string;
  contactId: string;
  preparationId: string;
}>;

async function fixture(seed: string): Promise<Fixture> {
  fixtureSequence += 1;
  const pilotId = randomUUID();
  const leadId = randomUUID();
  const contactId = randomUUID();
  const preparationId = randomUUID();
  await raw.begin(async (tx) => {
    await tx`insert into leads(id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,do_not_contact,crm_stage)
      values(${leadId}::uuid,'node',${`cloud-scope-${seed}`},'Empresa sintética','oficinas',90,
      'SEM_SITE_CADASTRADO',false,false,false,'NOVO')`;
    await tx`insert into pilot_runs(id,name,region,category,target_lead_count,status,created_by,started_at)
      values(${pilotId}::uuid,${`Cloud scope ${seed}`},'SP','oficinas',1,'RUNNING','integration-test',now())`;
    await tx`insert into pilot_leads(pilot_run_id,lead_id,source,added_by)
      values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`insert into lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp)
      values(${contactId}::uuid,${leadId}::uuid,'TELEFONE','synthetic-phone',${`+1202555${String(fixtureSequence).padStart(4, '0')}`},'HML_OPERATOR_CONTROLLED',1,now(),true,true)`;
    await tx`insert into pilot_manual_message_preparations(
      id,pilot_run_id,lead_id,contact_id,channel,template_id,template_version,
      operator_principal_id,payload_fingerprint,idempotency_key,result_fingerprint,result_snapshot,expires_at
    ) values(
      ${preparationId}::uuid,${pilotId}::uuid,${leadId}::uuid,${contactId}::uuid,
      'WHATSAPP','operator-whatsapp-channel-test','v1','hml-internal-whatsapp-operator',
      ${fingerprint(seed + 'a')} ,${`cloud-prep-${seed}`},${fingerprint(seed + 'b')},
      ${raw.json({
        schemaVersion: 2, channel: 'WHATSAPP', templateId: 'operator-whatsapp-channel-test',
        templateVersion: 'v1', variables: {}, contactFingerprint: fingerprint(seed + 'c'),
        messageFingerprint: fingerprint(seed + 'd'),
      })}::jsonb,now()+interval '1 hour'
    )`;
  });
  return { pilotId, leadId, contactId, preparationId };
}

const claim = async (item: Fixture, scope: 'HML_TEST' | 'HML_TEST_002', suffix: string) => raw`
  select * from public.create_manual_whatsapp_cloud_send_attempt(
    ${item.preparationId}::uuid,
    ${item.pilotId}::uuid,
    ${item.leadId}::uuid,
    ${item.contactId}::uuid,
    ${scope},
    'hml-internal-whatsapp-operator',
    ${fingerprint('1') }::char(64),
    ${fingerprint('2') }::char(64),
    ${fingerprint('3') }::char(64),
    ${fingerprint(suffix + '4') }::char(64),
    ${fingerprint(suffix + '5') }::char(64)
  )`;

const observedError = (error: unknown) => ({
  code: typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined,
  constraint: typeof error === 'object' && error !== null && 'constraint' in error
    ? (error as { constraint?: unknown }).constraint : undefined,
});

try {
  await raw`truncate pilot_manual_whatsapp_cloud_send_events,pilot_manual_whatsapp_cloud_send_attempts`;

  const firstScope = await fixture('first');
  const secondScope = await fixture('second');
  const firstClaim = await claim(firstScope, 'HML_TEST_002', 'first');
  assert.equal(firstClaim.length, 1, 'first claim must be allowed');

  let consumedError: unknown;
  try {
    await claim(secondScope, 'HML_TEST_002', 'second');
  } catch (error) {
    consumedError = error;
  }
  assert.deepEqual(observedError(consumedError), { code: '23505', constraint: scopeConstraint });

  const concurrentA = await fixture('concurrent-a');
  const concurrentB = await fixture('concurrent-b');
  const concurrent = await Promise.allSettled([
    claim(concurrentA, 'HML_TEST', 'concurrent-a'),
    claim(concurrentB, 'HML_TEST', 'concurrent-b'),
  ]);
  assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((item) => item.status === 'rejected').length, 1);
  const rejected = concurrent.find((item) => item.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.deepEqual(observedError(rejected.reason), { code: '23505', constraint: scopeConstraint });

  const counts = await raw`
    select send_scope,count(*)::int as attempts
    from public.pilot_manual_whatsapp_cloud_send_attempts
    where send_scope in ('HML_TEST','HML_TEST_002')
    group by send_scope order by send_scope
  `;
  assert.deepEqual(counts.map((row) => ({ scope: row.send_scope, attempts: Number(row.attempts) })), [
    { scope: 'HML_TEST', attempts: 1 },
    { scope: 'HML_TEST_002', attempts: 1 },
  ]);
  console.log(JSON.stringify({
    result: 'WHATSAPP_CLOUD_CONSUMED_SCOPE_POSTGRES_PASS',
    expectedConstraint: true,
    firstClaim: 'ALLOWED',
    secondClaim: 'BLOCKED',
    concurrentAllowed: 1,
    concurrentBlocked: 1,
    providerClientCalls: 0,
  }));
} finally {
  await raw`truncate pilot_manual_whatsapp_cloud_send_events,pilot_manual_whatsapp_cloud_send_attempts,pilot_manual_message_events,pilot_manual_message_preparations,pilot_reviews,pilot_leads,pilot_runs,lead_contacts,leads restart identity cascade`;
  await raw.end();
}
