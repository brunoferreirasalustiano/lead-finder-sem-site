import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import {
  approvedTemplates,
  DeterministicFakeMessagingProvider,
} from '@lead-finder/messaging';
import {
  createDatabase,
  ManualMessagingError,
  prepareManualMessage,
  recordManualOpen,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';
import { buildApp } from '../apps/api/src/app.js';

const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required');

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const provider = new DeterministicFakeMessagingProvider();
const principalId = 'narrow-contact-p1-test';
const auth = createAuthorizationContext({
  principalId,
  permissions: new Set(['manual-messaging:prepare']),
  authenticationMethod: 'integration-test',
});
const phone = '+12025550100';
const email = 'business@example.test';
const source = 'PUBLIC_BUSINESS_SOURCE';
const migrationsUrl = new URL('../database/migrations/', import.meta.url);
const migration0025 = await readFile(
  new URL('0025_narrow_contact_resolution.sql', migrationsUrl),
  'utf8',
);

const databaseName = `lf_narrow_p1_${randomUUID().replaceAll('-', '')}`.slice(0, 63);
const scenarioUrl = new URL(sourceUrl);
scenarioUrl.pathname = `/${databaseName}`;
const administrator = postgres(sourceUrl, { max: 1 });
let raw: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof createDatabase> | undefined;

const rejectCode = async (
  promise: Promise<unknown>,
  code: ManualMessagingError['code'],
) => assert.rejects(
  promise,
  (error: unknown) => error instanceof ManualMessagingError && error.code === code,
);

type Fixture = {
  pilotId: string;
  leadId: string;
  contactId: string;
  name: string;
  channel: 'WHATSAPP' | 'EMAIL';
};
let sequence = 0;
const fixture = async (
  client: ReturnType<typeof postgres>,
  options: { channel?: 'WHATSAPP' | 'EMAIL'; name?: string } = {},
): Promise<Fixture> => {
  sequence += 1;
  const channel = options.channel ?? 'WHATSAPP';
  const name = options.name ?? `Empresa P1 ${sequence}`;
  const pilotId = randomUUID();
  const leadId = randomUUID();
  const contactId = randomUUID();
  await client.begin(async (tx) => {
    await tx`insert into leads(
      id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,do_not_contact,crm_stage
    ) values(
      ${leadId}::uuid,'node',${`narrow-p1-${sequence}`},${name},'oficinas',90,
      'SEM_SITE_CADASTRADO',false,false,false,'NOVO'
    )`;
    await tx`insert into pilot_runs(
      id,name,region,category,target_lead_count,status,created_by,started_at
    ) values(
      ${pilotId}::uuid,${`Narrow P1 ${sequence}`} ,'SP','oficinas',1,'RUNNING',
      'integration-test',now()
    )`;
    await tx`insert into pilot_leads(pilot_run_id,lead_id,source,added_by)
      values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`insert into pilot_reviews(
      pilot_run_id,lead_id,decision,reviewer_principal_id,version
    ) values(${pilotId}::uuid,${leadId}::uuid,'APPROVED','reviewer',1)`;
    if (channel === 'WHATSAPP') {
      await tx`insert into lead_contacts(
        id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,
        is_valid,possible_whatsapp
      ) values(
        ${contactId}::uuid,${leadId}::uuid,'TELEFONE',${phone},${phone},${source},1,
        now(),true,true
      )`;
      await tx`insert into contact_channel_authorizations(
        contact_id,lead_id,channel,purpose,origin,evidence_fingerprint,granted_at,recorded_by
      ) values(
        ${contactId}::uuid,${leadId}::uuid,'WHATSAPP','B2B_PROSPECTION','DIRECT_OPT_IN',
        ${digest(`authorization-${sequence}`)},now(),'integration-test'
      )`;
    } else {
      await tx`insert into lead_contacts(
        id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,
        is_valid,possible_whatsapp
      ) values(
        ${contactId}::uuid,${leadId}::uuid,'EMAIL',${email},${email},${source},1,
        now(),true,false
      )`;
      await tx`insert into contact_email_business_evidence(
        contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,human_decision,
        reviewer_principal_id,version
      ) values(
        ${contactId}::uuid,${leadId}::uuid,'EMAIL','BUSINESS','PUBLIC_BUSINESS_SOURCE',
        ${digest(`email-${sequence}`)},'APPROVED','reviewer',1
      )`;
    }
  });
  return { pilotId, leadId, contactId, name, channel };
};

try {
  await administrator.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  raw = postgres(scenarioUrl.toString(), { max: 1 });
  const baselineMigrations = (await readdir(migrationsUrl))
    .filter((file) => /^\d{4}.*\.sql$/.test(file) && file < '0025_narrow_contact_resolution.sql')
    .sort();
  for (const file of baselineMigrations) {
    await raw.unsafe(await readFile(new URL(file, migrationsUrl), 'utf8'));
  }

  const legacy = await fixture(raw, { name: 'Empresa Legada' });
  const legacyInput = {
    contactId: legacy.contactId,
    requestedChannel: 'WHATSAPP' as const,
    templateId: approvedTemplates.whatsappV1.id,
    templateVersion: approvedTemplates.whatsappV1.version,
    idempotencyKey: randomUUID(),
  };
  const legacyVariables = { EMPRESA: legacy.name, FONTE: source };
  const legacyPrepared = provider.prepare(approvedTemplates.whatsappV1, legacyVariables);
  const legacySnapshot = {
    channel: 'WHATSAPP',
    templateId: approvedTemplates.whatsappV1.id,
    templateVersion: approvedTemplates.whatsappV1.version,
    variables: legacyVariables,
    contactFingerprint: digest({
      contactId: legacy.contactId,
      channel: 'TELEFONE',
      value: phone,
    }),
    messageFingerprint: legacyPrepared.fingerprint,
  };
  const legacyPayloadFingerprint = digest({
    pilotRunId: legacy.pilotId,
    leadId: legacy.leadId,
    ...legacyInput,
    principalId,
  });
  const legacyPreparationId = randomUUID();
  await raw`insert into pilot_manual_message_preparations(
    id,pilot_run_id,lead_id,contact_id,channel,template_id,template_version,
    operator_principal_id,payload_fingerprint,idempotency_key,result_fingerprint,result_snapshot
  ) values(
    ${legacyPreparationId}::uuid,${legacy.pilotId}::uuid,${legacy.leadId}::uuid,
    ${legacy.contactId}::uuid,'WHATSAPP',${legacyInput.templateId},${legacyInput.templateVersion},
    ${principalId},${legacyPayloadFingerprint},${legacyInput.idempotencyKey},
    ${digest(legacySnapshot)},${raw.json(legacySnapshot)}::jsonb
  )`;

  await raw.unsafe(migration0025);
  database = createDatabase(scenarioUrl.toString(), { max: 4 });
  const legacyReplay = await prepareManualMessage(
    database.db,
    legacy.pilotId,
    legacy.leadId,
    legacyInput,
    auth,
  );
  assert.equal(legacyReplay.preparationId, legacyPreparationId);
  assert.equal(legacyReplay.replayed, true);
  assert.match(legacyReplay.contactFingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(legacyReplay.contactFingerprint, legacySnapshot.contactFingerprint);

  const nameDrift = await fixture(raw, { name: 'Empresa Antes' });
  const nameInput = {
    contactId: nameDrift.contactId,
    requestedChannel: 'WHATSAPP' as const,
    templateId: approvedTemplates.whatsappV1.id,
    templateVersion: approvedTemplates.whatsappV1.version,
    idempotencyKey: randomUUID(),
  };
  const namePreparation = await prepareManualMessage(
    database.db,
    nameDrift.pilotId,
    nameDrift.leadId,
    nameInput,
    auth,
  );
  await raw`update leads set name='Empresa Depois' where id=${nameDrift.leadId}::uuid`;
  await rejectCode(
    recordManualOpen(
      database.db,
      namePreparation.preparationId,
      { idempotencyKey: randomUUID() },
      auth,
    ),
    'INVALID_STATE',
  );
  assert.equal(
    Number((await raw`select count(*)::int value from pilot_manual_message_events
      where preparation_id=${namePreparation.preparationId}::uuid`)[0]?.value),
    0,
  );

  const templateDrift = await fixture(raw, { name: 'Empresa Template' });
  const templateInput = {
    contactId: templateDrift.contactId,
    requestedChannel: 'WHATSAPP' as const,
    templateId: approvedTemplates.whatsappV1.id,
    templateVersion: approvedTemplates.whatsappV1.version,
    idempotencyKey: randomUUID(),
  };
  const templatePreparation = await prepareManualMessage(
    database.db,
    templateDrift.pilotId,
    templateDrift.leadId,
    templateInput,
    auth,
  );
  const mutableTemplate = approvedTemplates.whatsappV1 as { body: string };
  const originalTemplateBody = mutableTemplate.body;
  try {
    mutableTemplate.body = `${originalTemplateBody} Conteúdo alterado sem nova versão.`;
    await rejectCode(
      recordManualOpen(
        database.db,
        templatePreparation.preparationId,
        { idempotencyKey: randomUUID() },
        auth,
      ),
      'INVALID_STATE',
    );
  } finally {
    mutableTemplate.body = originalTemplateBody;
  }
  assert.equal(
    Number((await raw`select count(*)::int value from pilot_manual_message_events
      where preparation_id=${templatePreparation.preparationId}::uuid`)[0]?.value),
    0,
  );

  const legitimate = await fixture(raw, { name: 'Empresa Legítima' });
  const legitimatePreparation = await prepareManualMessage(
    database.db,
    legitimate.pilotId,
    legitimate.leadId,
    {
      contactId: legitimate.contactId,
      requestedChannel: 'WHATSAPP',
      templateId: approvedTemplates.whatsappV1.id,
      templateVersion: approvedTemplates.whatsappV1.version,
      idempotencyKey: randomUUID(),
    },
    auth,
  );
  const opened = await recordManualOpen(
    database.db,
    legitimatePreparation.preparationId,
    { idempotencyKey: randomUUID() },
    auth,
  );
  assert.equal(opened.state, 'OPENED');

  const emailFixture = await fixture(raw, { channel: 'EMAIL', name: 'Empresa Email' });
  const emailInput = {
    contactId: emailFixture.contactId,
    requestedChannel: 'EMAIL' as const,
    templateId: approvedTemplates.emailV1.id,
    templateVersion: approvedTemplates.emailV1.version,
    idempotencyKey: randomUUID(),
  };
  await rejectCode(
    prepareManualMessage(
      database.db,
      emailFixture.pilotId,
      emailFixture.leadId,
      emailInput,
      auth,
    ),
    'EMAIL_CONSUMER_UNAVAILABLE',
  );

  const token = 'synthetic-narrow-p1-api-token-0000000001';
  const app = buildApp(database.db, {
    authentication: {
      token,
      principalId,
      principalPermissions: ['manual-messaging:prepare'],
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/pilots/${emailFixture.pilotId}/leads/${emailFixture.leadId}/manual-messages/prepare`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': randomUUID(),
      },
      payload: emailInput,
    });
    assert.equal(response.statusCode, 422);
    assert.equal(
      response.json<{ code: string }>().code,
      'EMAIL_CONSUMER_UNAVAILABLE',
    );
  } finally {
    await app.close();
  }
  assert.equal(
    Number((await raw`select count(*)::int value from pilot_manual_message_preparations
      where lead_id=${emailFixture.leadId}::uuid`)[0]?.value),
    0,
  );

  assert.equal(Number((await raw`select count(*)::int value from campaign_outbox`)[0]?.value), 0);
  assert.equal(Number((await raw`select count(*)::int value from campaign_dead_letters`)[0]?.value), 0);
  assert.equal(Number((await raw`select count(*)::int value from campaign_provider_events`)[0]?.value), 0);

  console.log(JSON.stringify({
    result: 'NARROW_CONTACT_P1_REGRESSIONS_PASS',
    legacyUpgradeReplay: true,
    leadNameDriftBlocked: true,
    templateContentDriftBlocked: true,
    emailFailClosed: true,
    legitimateWhatsAppOpen: true,
    providerCalls: 0,
    networkMessageCalls: 0,
  }));
} finally {
  await database?.close().catch(() => undefined);
  await raw?.end().catch(() => undefined);
  await administrator.unsafe(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
  ).catch(() => undefined);
  await administrator.end();
}
