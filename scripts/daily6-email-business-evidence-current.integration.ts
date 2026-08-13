import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { prepareMigrationSqlForRunner } from './migration-sql.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migrationDirectory = new URL('../database/migrations/', import.meta.url);
const legacyMigration = prepareMigrationSqlForRunner(
  await readFile(new URL('0061_daily6_progressive_discovery_pool.sql', migrationDirectory), 'utf8'),
);
const currentMigration = prepareMigrationSqlForRunner(
  await readFile(
    new URL('0062_daily6_current_email_business_evidence.sql', migrationDirectory),
    'utf8',
  ),
);

const sql = postgres(databaseUrl, { max: 1 });
const leadId = crypto.randomUUID();
const contactId = crypto.randomUUID();
const approvedFingerprint = 'a'.repeat(64);
const rejectedFingerprint = 'b'.repeat(64);
const rollback = Symbol('rollback-fixture');

try {
  let rolledBack = false;
  try {
    await sql.begin(async (transaction) => {
      // Reapply the immutable 0061 function only inside this transaction to
      // reproduce the historical EXISTS behavior before the 0062 upgrade.
      await transaction.unsafe(legacyMigration);

      await transaction`
        INSERT INTO public.leads(
          id,osm_type,osm_id,name,category,city,score,status,qualification_status,
          website_status,is_blocked,do_not_contact
        ) VALUES (
          ${leadId}::uuid,'node',${`daily6-evidence-${leadId}`},
          'Current evidence upgrade fixture','integration','upgrade-test-city',1,
          'SEM_SITE_CADASTRADO','SEM_SITE_CONFIRMADO','NO_OFFICIAL_SITE_CONFIRMED',
          false,false
        )
      `;
      await transaction`
        INSERT INTO public.lead_contacts(
          id,lead_id,type,original_value,normalized_value,source,confidence,
          verified_at,is_valid,possible_whatsapp
        ) VALUES (
          ${contactId}::uuid,${leadId}::uuid,'EMAIL',
          'daily6-current-evidence@example.test',
          'daily6-current-evidence@example.test','INTEGRATION',1,now(),true,false
        )
      `;

      await transaction`
        INSERT INTO public.contact_email_business_evidence(
          contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,
          human_decision,reviewer_principal_id,version
        ) VALUES (
          ${contactId}::uuid,${leadId}::uuid,'EMAIL','BUSINESS',
          'PUBLIC_BUSINESS_SOURCE',${approvedFingerprint}::char(64),
          'APPROVED','daily6-p2-upgrade-test',1
        )
      `;

      const approved = await transaction<{ email_business_association_pass: boolean }[]>`
        SELECT email_business_association_pass
        FROM lead_finder_internal.list_daily6_candidates('upgrade-test-city','integration',40)
        WHERE lead_id=${leadId}::uuid
      `;
      assert.equal(approved[0]?.email_business_association_pass, true);

      await transaction`
        INSERT INTO public.contact_email_business_evidence(
          contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,
          human_decision,reviewer_principal_id,version
        ) VALUES (
          ${contactId}::uuid,${leadId}::uuid,'EMAIL','BUSINESS',
          'PUBLIC_BUSINESS_SOURCE',${rejectedFingerprint}::char(64),
          'REJECTED','daily6-p2-upgrade-test',2
        )
      `;

      const legacyAfterRejection = await transaction<
        {
          email_business_association_pass: boolean;
        }[]
      >`
        SELECT email_business_association_pass
        FROM lead_finder_internal.list_daily6_candidates('upgrade-test-city','integration',40)
        WHERE lead_id=${leadId}::uuid
      `;
      assert.equal(
        legacyAfterRejection[0]?.email_business_association_pass,
        true,
        '0061 reproduces the historical EXISTS selection gap',
      );

      await transaction.unsafe(currentMigration);

      const currentAfterRejection = await transaction<
        {
          email_business_association_pass: boolean;
        }[]
      >`
        SELECT email_business_association_pass
        FROM lead_finder_internal.list_daily6_candidates('upgrade-test-city','integration',40)
        WHERE lead_id=${leadId}::uuid
      `;
      assert.equal(
        currentAfterRejection[0]?.email_business_association_pass,
        false,
        '0062 must use the newest REJECTED decision and fail closed',
      );

      // Evidence is append-only, so roll back the complete fixture and the
      // temporary function replacement instead of deleting test history.
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
    rolledBack = true;
  }
  assert.equal(rolledBack, true);
  console.log(
    JSON.stringify({
      result: 'DAILY6_CURRENT_EMAIL_BUSINESS_EVIDENCE_PASS',
      legacyApproved: 'PASS',
      legacyAfterNewerRejected: 'EXPECTED_GAP',
      currentAfterNewerRejected: 'FAIL_CLOSED',
      fixture: 'ROLLED_BACK',
    }),
  );
} finally {
  await sql.end();
}
