import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { reconcile } from './restore-suppression/apply.js';
import { sha256 } from './restore-suppression/canonical.js';
import { prepareLegacyPre0048Restore, recoverPrecontactHmacKey } from './restore-suppression/key-recovery.js';
import { manifestContentSchema } from './restore-suppression/types.js';
import { validateManifestValue } from './restore-suppression/validate.js';
import { verifyReconciliation } from './restore-suppression/verify.js';

const databaseUrl=process.env['DATABASE_URL']; if(!databaseUrl)throw new Error('DATABASE_URL_REQUIRED');
const migrations=new URL('../database/migrations/',import.meta.url);
const migration0048Name='0048_precontact_email_delivery_suppression.sql';
const migration0049Name='0049_precontact_email_existing_duplicate_hardening.sql';
const migration0048=await readFile(new URL(migration0048Name,migrations),'utf8');
const migration0049=await readFile(new URL(migration0049Name,migrations),'utf8');
const admin=postgres(databaseUrl,{max:1});

const applyPre0048=async(sql:ReturnType<typeof postgres>)=>{
  for(const file of (await readdir(migrations)).filter((name)=>name<migration0048Name).sort()){
    await sql.unsafe(await readFile(new URL(file,migrations),'utf8'));
  }
};
const createDatabase=async(name:string)=>{
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const parsed=new URL(databaseUrl); parsed.pathname=`/${name}`;
  const url=parsed.toString(); return {url,sql:postgres(url,{max:1})};
};
const dropDatabase=async(name:string)=>{await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);};
const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const keyDigest=(key:Buffer)=>createHash('sha256').update(key).digest('hex');
const identity=(key:Buffer,email:string)=>createHmac('sha256',key).update(email.trim().toLowerCase(),'utf8').digest('hex');
const buildManifest=(key:Buffer,event?:{identityFingerprint:string;reasonCode:'HARD_BOUNCE'|'INVALID_CONTACT';operationalSource:string;eventFingerprint:string;occurredAt:string})=>{
  const events=event?[event]:[];
  const fingerprints=event?[event.identityFingerprint]:[];
  const content=manifestContentSchema.parse({
    schemaVersion:'1.0',runId:randomUUID(),logicalOrigin:'DATABASE_PRE_RESTORE',
    cutoffAt:'2026-08-10T12:00:00.000Z',entries:[],
    counts:{total:0,byType:{IS_BLOCKED:0,DO_NOT_CONTACT:0,CRM_NAO_CONTATAR:0,OPT_OUT_GLOBAL:0,OPT_OUT_CHANNEL:0}},
    precontactPermanent:{keyDigest:keyDigest(key),fingerprints,events,counts:{fingerprints:fingerprints.length,events:events.length}},
  });
  return validateManifestValue({...content,digest:sha256(content)});
};
const seedLegacyBounce=async(sql:ReturnType<typeof postgres>,suffix:string)=>{
  const leadId=randomUUID(); const contactId=randomUUID();
  const bouncedEmail=`legacy-${suffix}@example.test`; const replacementEmail=`replacement-${suffix}@example.test`;
  const eventFingerprint=digest(`pre0048-legacy-${suffix}`); const occurredAt='2026-08-08T15:00:00.000Z';
  await sql`INSERT INTO leads(id,osm_type,osm_id,name,category,score,status,is_closed) VALUES(${leadId}::uuid,'node',${`legacy-${suffix}`},'Legacy restore fixture','integration',1,'SEM_SITE_CADASTRADO',false)`;
  await sql`INSERT INTO lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp) VALUES(${contactId}::uuid,${leadId}::uuid,'EMAIL',${bouncedEmail},${bouncedEmail},'INTEGRATION',1,now(),true,false)`;
  const binding=(await sql<{fingerprint:string}[]>`SELECT contact_resolution_fingerprint fingerprint FROM lead_contacts WHERE id=${contactId}::uuid`)[0]!.fingerprint;
  await sql`SELECT * FROM public.record_email_delivery_suppression(${contactId}::uuid,${leadId}::uuid,${binding}::char(64),'HARD_BOUNCE','RESTORE_LEGACY_TEST',${eventFingerprint}::char(64),${occurredAt}::timestamptz)`;
  return {leadId,contactId,bouncedEmail,replacementEmail,eventFingerprint,occurredAt};
};

try{
  const resolvedName=`leadfinder_restore_pre0048_resolved_${process.pid}`;
  const resolved=await createDatabase(resolvedName);
  try{
    await applyPre0048(resolved.sql);
    const fixture=await seedLegacyBounce(resolved.sql,'resolved');
    await resolved.sql`UPDATE lead_contacts SET original_value=${fixture.replacementEmail},normalized_value=${fixture.replacementEmail},is_valid=true WHERE id=${fixture.contactId}::uuid`;

    const key=randomBytes(32); const keyHex=key.toString('hex');
    const bouncedIdentity=identity(key,fixture.bouncedEmail);
    const replacementIdentity=identity(key,fixture.replacementEmail);
    const manifest=buildManifest(key,{
      identityFingerprint:bouncedIdentity,reasonCode:'HARD_BOUNCE',operationalSource:'RESTORE_LEGACY_TEST',
      eventFingerprint:fixture.eventFingerprint,occurredAt:fixture.occurredAt,
    });

    const prepared=await prepareLegacyPre0048Restore(keyHex,manifest,resolved.url);
    assert.deepEqual(prepared,{prepared:true,legacyEvents:1});
    const bridge=await resolved.sql<{historical_identity:string;global_identity:string;key_digest:string}[]>`
      SELECT suppression.email_precontact_identity_fingerprint::text historical_identity,
        global_suppression.identity_fingerprint::text global_identity,
        (SELECT encode(extensions.digest(secret,'sha256'),'hex') FROM lead_finder_private.email_suppression_hmac_key WHERE singleton=true) key_digest
      FROM contact_delivery_suppressions suppression
      JOIN email_precontact_delivery_suppressions global_suppression USING(event_fingerprint)
      WHERE suppression.event_fingerprint=${fixture.eventFingerprint}::char(64)`;
    assert.deepEqual(bridge[0],{historical_identity:bouncedIdentity,global_identity:bouncedIdentity,key_digest:manifest.precontactPermanent.keyDigest});

    await resolved.sql.unsafe(migration0048);
    await resolved.sql.unsafe(migration0049);
    const recovery=await recoverPrecontactHmacKey(keyHex,manifest,resolved.url);
    assert.deepEqual(recovery,{rekeyed:false,contactsRekeyed:0});
    const report=await reconcile(manifest,true,'ci-pre0048-legacy',resolved.url); assert.equal(report.result,'SAFE');
    assert.equal(await verifyReconciliation(manifest,resolved.url),'RESTORE_SUPPRESSION_SAFE');

    const final=await resolved.sql<{is_valid:boolean;current_identity:string;historical_identity:string;suppressed:boolean;events:number}[]>`
      SELECT contact.is_valid,
        contact.email_precontact_identity_fingerprint::text current_identity,
        suppression.email_precontact_identity_fingerprint::text historical_identity,
        identity.suppressed,
        (SELECT count(*)::int FROM email_precontact_delivery_suppressions WHERE event_fingerprint=${fixture.eventFingerprint}::char(64)) events
      FROM lead_contacts contact
      JOIN contact_delivery_suppressions suppression ON suppression.contact_id=contact.id AND suppression.lead_id=contact.lead_id
      JOIN lead_finder_private.email_contact_identities identity ON identity.identity_fingerprint=suppression.email_precontact_identity_fingerprint
      WHERE contact.id=${fixture.contactId}::uuid AND suppression.event_fingerprint=${fixture.eventFingerprint}::char(64)`;
    assert.deepEqual(final[0],{is_valid:true,current_identity:replacementIdentity,historical_identity:bouncedIdentity,suppressed:true,events:1});
  }finally{await resolved.sql.end();await dropDatabase(resolvedName);}

  const unresolvedName=`leadfinder_restore_pre0048_unresolved_${process.pid}`;
  const unresolved=await createDatabase(unresolvedName);
  try{
    await applyPre0048(unresolved.sql);
    const fixture=await seedLegacyBounce(unresolved.sql,'unresolved');
    const key=randomBytes(32); const manifest=buildManifest(key);
    await assert.rejects(
      ()=>prepareLegacyPre0048Restore(key.toString('hex'),manifest,unresolved.url),
      (error:unknown)=>error instanceof Error&&error.message.includes('PRE0048_LEGACY_SUPPRESSION_UNRESOLVED'),
    );
    const proof=await unresolved.sql<{legacy:number;global_relation:string|null;identity_column:boolean}[]>`
      SELECT
        (SELECT count(*)::int FROM contact_delivery_suppressions WHERE event_fingerprint=${fixture.eventFingerprint}::char(64)) legacy,
        to_regclass('public.email_precontact_delivery_suppressions')::text global_relation,
        EXISTS(
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='contact_delivery_suppressions'
            AND column_name='email_precontact_identity_fingerprint'
        ) identity_column`;
    assert.deepEqual(proof[0],{legacy:1,global_relation:null,identity_column:false});
  }finally{await unresolved.sql.end();await dropDatabase(unresolvedName);}

  process.stdout.write(JSON.stringify({gate:'RESTORE_PRE0048_LEGACY',result:'PASS',exactManifestBridge:true,replacementAddressNotSuppressed:true,unresolvedFailsClosed:true})+'\n');
}finally{await admin.end();}
