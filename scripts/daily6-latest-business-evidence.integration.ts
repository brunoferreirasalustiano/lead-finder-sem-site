import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { prepareMigrationSqlForRunner } from './migration-sql.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migrationDirectory = new URL('../database/migrations/', import.meta.url);
const historicalMigration = prepareMigrationSqlForRunner(
  await readFile(new URL('0062_daily6_current_email_business_evidence.sql', migrationDirectory), 'utf8'),
);
const latestMigration = prepareMigrationSqlForRunner(
  await readFile(new URL('0072_daily6_latest_business_evidence.sql', migrationDirectory), 'utf8'),
);

const sql = postgres(databaseUrl, { max: 1 });
const leadId = crypto.randomUUID();
const contactId = crypto.randomUUID();
const rollback = Symbol('rollback-fixture');

try {
  let rolledBack = false;
  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe(historicalMigration);
      await transaction`
        INSERT INTO public.leads(
          id,osm_type,osm_id,name,category,city,score,status,qualification_status,
          website_status,is_blocked,do_not_contact
        ) VALUES (
          ${leadId}::uuid,'node',${`daily6-latest-${leadId}`},
          'Latest evidence fixture','integration','latest-evidence-city',1,
          'SEM_SITE_CADASTRADO','SEM_SITE_CONFIRMADO','NO_OFFICIAL_SITE_CONFIRMED',
          false,false
        )`;
      await transaction`
        INSERT INTO public.lead_contacts(
          id,lead_id,type,original_value,normalized_value,source,confidence,
          verified_at,is_valid,possible_whatsapp
        ) VALUES (
          ${contactId}::uuid,${leadId}::uuid,'EMAIL','latest-evidence@example.test',
          'latest-evidence@example.test','INTEGRATION',1,now(),true,false
        )`;
      await transaction`
        INSERT INTO public.contact_email_business_evidence(
          contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,
          human_decision,reviewer_principal_id,version
        ) VALUES (
          ${contactId}::uuid,${leadId}::uuid,'EMAIL','BUSINESS',
          'PUBLIC_BUSINESS_SOURCE',${'a'.repeat(64)}::char(64),
          'APPROVED','daily6-latest-evidence-test',1
        )`;

      const insertEvidence = async (
        type: string,
        result: string,
        verification: string,
        confidence: number,
        observedAt: string,
      ) => transaction`
        INSERT INTO public.lead_evidence(
          lead_id,source,reference,evidence_type,verification_status,result,
          confidence,observed_at,fingerprint
        ) VALUES (
          ${leadId}::uuid,'INTEGRATION','https://example.test/evidence',${type},
          ${verification},${result},${confidence},${observedAt}::timestamptz,
          ${`${type}:${result}:${observedAt}`}
        )`;

      await insertEvidence('BUSINESS_IDENTITY', 'BUSINESS_IDENTITY_CONFIRMED', 'VERIFIED', 0.95, '2026-09-01T00:00:00Z');
      await insertEvidence('BUSINESS_ACTIVITY', 'ACTIVE', 'VERIFIED', 0.95, '2026-09-01T00:00:00Z');
      await insertEvidence('WEBSITE', 'NO_OFFICIAL_SITE_CONFIRMED', 'VERIFIED', 0.95, '2026-09-01T00:00:00Z');
      await insertEvidence('BUSINESS_EMAIL', 'EMAIL_BUSINESS_ASSOCIATION_PASS', 'VERIFIED', 0.95, '2026-09-01T00:00:00Z');

      await insertEvidence('BUSINESS_IDENTITY', 'BUSINESS_IDENTITY_UNCONFIRMED', 'UNVERIFIED', 0.20, '2026-09-02T00:00:00Z');
      await insertEvidence('BUSINESS_ACTIVITY', 'INACTIVE', 'UNVERIFIED', 0.99, '2026-09-02T00:00:00Z');
      await insertEvidence('WEBSITE', 'OFFICIAL_SITE_FOUND', 'UNVERIFIED', 0.99, '2026-09-02T00:00:00Z');

      const historical = await transaction<{
        business_identity_confirmed: boolean;
        business_active_pass: boolean;
        site_search_high: boolean;
      }[]>`
        SELECT business_identity_confirmed,business_active_pass,site_search_high
        FROM lead_finder_internal.list_daily6_candidates('latest-evidence-city','integration',40)
        WHERE lead_id=${leadId}::uuid`;
      assert.deepEqual(historical[0], {
        business_identity_confirmed: true,
        business_active_pass: true,
        site_search_high: true,
      }, '0062 reproduces the historical any-PASS evidence gap');

      await transaction.unsafe(latestMigration);
      const current = await transaction<{
        business_identity_confirmed: boolean;
        business_active_pass: boolean;
        site_search_high: boolean;
      }[]>`
        SELECT business_identity_confirmed,business_active_pass,site_search_high
        FROM lead_finder_internal.list_daily6_candidates('latest-evidence-city','integration',40)
        WHERE lead_id=${leadId}::uuid`;
      assert.deepEqual(current[0], {
        business_identity_confirmed: false,
        business_active_pass: false,
        site_search_high: false,
      }, '0072 must let the newest fail-closed evidence supersede historical PASS rows');

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
    rolledBack = true;
  }
  assert.equal(rolledBack, true);
  console.log(JSON.stringify({
    result: 'DAILY6_LATEST_BUSINESS_EVIDENCE_PASS',
    historicalAnyPass: 'EXPECTED_GAP',
    latestDecision: 'FAIL_CLOSED',
    fixture: 'ROLLED_BACK',
  }));
} finally {
  await sql.end();
}
