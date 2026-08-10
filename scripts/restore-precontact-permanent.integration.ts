import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { exportManifest } from './restore-suppression/export.js';
import { reconcile } from './restore-suppression/apply.js';
import { exportPrecontactHmacKey, recoverPrecontactHmacKey } from './restore-suppression/key-recovery.js';
import { verifyReconciliation } from './restore-suppression/verify.js';
import { validateManifestValue } from './restore-suppression/validate.js';
import { sha256 } from './restore-suppression/canonical.js';

const url=process.env['DATABASE_URL']; if(!url)throw new Error('DATABASE_URL_REQUIRED');
const run=(command:string,args:string[])=>new Promise<void>((resolve,reject)=>{const child=spawn(command,args,{stdio:['ignore','ignore','pipe'],env:process.env});let error='';child.stderr.on('data',(data)=>error+=String(data).replace(/postgres(?:ql)?:\/\/[^\s]+/giu,'postgresql://***'));child.on('exit',(code)=>code===0?resolve():reject(new Error(`${command}_FAILED:${code}:${error.slice(0,300)}`)));});
const temp=await mkdtemp(join(tmpdir(),'restore-precontact-permanent-'));
const dump=join(temp,'stale.dump');
const manifestPath=join(temp,'manifest.json');
const emptyManifestPath=join(temp,'empty-manifest.json');
const keyCapsule=join(temp,'precontact-hmac-key');
let sql=postgres(url,{max:1});
try{
  await sql.unsafe(`TRUNCATE TABLE public.email_precontact_delivery_suppressions, public.contact_delivery_suppressions, public.lead_contacts, lead_finder_private.email_contact_identities, campaign_provider_events, campaign_outbox, campaign_attempts, campaign_recipients, campaign_opt_outs, crm_timeline_events, restore_suppression_runs, campaigns, leads CASCADE`);

  const emptyManifest=await exportManifest(emptyManifestPath,url);
  assert.deepEqual(emptyManifest.precontactPermanent.counts,{fingerprints:0,events:0});
  const emptyManifestKeyDigest=emptyManifest.precontactPermanent.keyDigest;
  await sql`UPDATE lead_finder_private.email_suppression_hmac_key SET secret=extensions.gen_random_bytes(32),created_at=clock_timestamp() WHERE singleton=true`;
  const rebasedKey=await sql<{key_digest:string}[]>`SELECT encode(extensions.digest(secret,'sha256'),'hex') key_digest FROM lead_finder_private.email_suppression_hmac_key WHERE singleton=true`;
  assert.equal(rebasedKey.length,1); assert.notEqual(rebasedKey[0]!.key_digest,emptyManifestKeyDigest);
  const emptyDry=await reconcile(emptyManifest,false,'ci-restore-pre0048-empty',url);
  assert.equal(emptyDry.result,'SAFE');
  assert.deepEqual(emptyDry.precontactPermanent,{keyMatched:false,fingerprints:0,events:0,alreadyApplied:0,requiringChange:0,conflicts:0});
  await reconcile(emptyManifest,true,'ci-restore-pre0048-empty',url);
  assert.equal(await verifyReconciliation(emptyManifest,url),'RESTORE_SUPPRESSION_SAFE');

  const leadId=randomUUID(); const contactId=randomUUID(); const rawAddress=`restore-precontact-${randomUUID()}@example.test`;
  await sql`INSERT INTO leads(id,osm_type,osm_id,name,category,score,status,is_closed) VALUES(${leadId}::uuid,'node',${`restore-precontact-${leadId}`},'Restore precontact fixture','integration',1,'SEM_SITE_CADASTRADO',false)`;
  await sql`INSERT INTO lead_contacts(id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp) VALUES(${contactId}::uuid,${leadId}::uuid,'EMAIL',${rawAddress},${rawAddress},'INTEGRATION',1,now(),true,false)`;
  const beforeDump=await sql<{binding:string;identity:string;key_digest:string}[]>`
    SELECT c.contact_resolution_fingerprint binding,c.email_precontact_identity_fingerprint::text identity,
      (SELECT encode(extensions.digest(secret,'sha256'),'hex') FROM lead_finder_private.email_suppression_hmac_key WHERE singleton=true) key_digest
    FROM lead_contacts c WHERE c.id=${contactId}::uuid`;
  assert.equal(beforeDump.length,1); assert.ok(beforeDump[0]!.identity);
  await run('pg_dump',['--format=custom','--no-owner','--no-acl','--file',dump,url]);

  const occurredAt=new Date('2026-08-09T18:00:00.000Z'); const eventFingerprint=sha256({kind:'RESTORE_PRECONTACT_PERMANENT',leadId});
  await sql`SELECT * FROM public.record_email_delivery_suppression(${contactId}::uuid,${leadId}::uuid,${beforeDump[0]!.binding}::char(64),'HARD_BOUNCE','RESTORE_PRECONTACT_TEST',${eventFingerprint}::char(64),${occurredAt.toISOString()}::timestamptz)`;
  const liveState=await sql<{is_valid:boolean;suppressed:boolean;events:number}[]>`
    SELECT c.is_valid,i.suppressed,(SELECT count(*)::int FROM public.email_precontact_delivery_suppressions WHERE event_fingerprint=${eventFingerprint}::char(64)) events
    FROM lead_contacts c JOIN lead_finder_private.email_contact_identities i ON i.identity_fingerprint=c.email_precontact_identity_fingerprint
    WHERE c.id=${contactId}::uuid`;
  assert.deepEqual(liveState[0],{is_valid:false,suppressed:true,events:1});

  const manifest=await exportManifest(manifestPath,url);
  assert.equal(manifest.entries.length,0);
  assert.deepEqual(manifest.precontactPermanent.counts,{fingerprints:1,events:1});
  assert.equal(manifest.precontactPermanent.keyDigest,beforeDump[0]!.key_digest);
  assert.equal(manifest.precontactPermanent.fingerprints[0],beforeDump[0]!.identity);
  assert.equal(manifest.precontactPermanent.events[0]!.eventFingerprint,eventFingerprint);
  const capsule=await exportPrecontactHmacKey(keyCapsule,url);
  assert.equal(capsule.keyDigest,manifest.precontactPermanent.keyDigest);
  const capsuleMetadata=await stat(keyCapsule);
  assert.equal(capsuleMetadata.mode&0o077,0);
  const serialized=await readFile(manifestPath,'utf8'); assert.doesNotMatch(serialized,new RegExp(rawAddress.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'u')); assert.doesNotMatch(serialized,/"secret"|"email"|databaseurl|connectionstring/iu);

  await sql.end();
  await run('pg_restore',['--clean','--if-exists','--exit-on-error','--no-owner','--no-acl','--dbname',url,dump]);
  sql=postgres(url,{max:1});
  const stale=await sql<{is_valid:boolean;suppressed:boolean;events:number;key_digest:string}[]>`
    SELECT c.is_valid,i.suppressed,(SELECT count(*)::int FROM public.email_precontact_delivery_suppressions WHERE event_fingerprint=${eventFingerprint}::char(64)) events,
      (SELECT encode(extensions.digest(secret,'sha256'),'hex') FROM lead_finder_private.email_suppression_hmac_key WHERE singleton=true) key_digest
    FROM lead_contacts c JOIN lead_finder_private.email_contact_identities i ON i.identity_fingerprint=c.email_precontact_identity_fingerprint
    WHERE c.id=${contactId}::uuid`;
  assert.deepEqual(stale[0],{is_valid:true,suppressed:false,events:0,key_digest:manifest.precontactPermanent.keyDigest});

  // Model the state produced when a pre-0048 backup is restored and migration 0048
  // creates a new random key: there is no permanent suppression state in the
  // restored database, but contacts are fingerprinted with the generated key.
  await sql`UPDATE lead_finder_private.email_suppression_hmac_key SET secret=extensions.gen_random_bytes(32),created_at=clock_timestamp() WHERE singleton=true`;
  await sql`UPDATE public.lead_contacts SET normalized_value=normalized_value WHERE id=${contactId}::uuid`;
  const generated=await sql<{key_digest:string;identity:string}[]>`
    SELECT
      encode(extensions.digest(key.secret,'sha256'),'hex') key_digest,
      contact.email_precontact_identity_fingerprint::text identity
    FROM lead_finder_private.email_suppression_hmac_key key
    CROSS JOIN public.lead_contacts contact
    WHERE key.singleton=true AND contact.id=${contactId}::uuid`;
  assert.equal(generated.length,1);
  assert.notEqual(generated[0]!.key_digest,manifest.precontactPermanent.keyDigest);
  assert.notEqual(generated[0]!.identity,manifest.precontactPermanent.fingerprints[0]);
  const blockedBeforeRecovery=await reconcile(manifest,false,'ci-restore-pre0048-nonempty',url);
  assert.equal(blockedBeforeRecovery.result,'BLOCKED');
  assert.equal(blockedBeforeRecovery.reason,'PRECONTACT_SUPPRESSION_KEY_MISMATCH');
  await sql.end();

  const recovery=await recoverPrecontactHmacKey(keyCapsule,manifest,url);
  assert.equal(recovery.rekeyed,true);
  assert.ok(recovery.contactsRekeyed>=1);
  sql=postgres(url,{max:1});
  const recovered=await sql<{key_digest:string;identity:string}[]>`
    SELECT
      encode(extensions.digest(key.secret,'sha256'),'hex') key_digest,
      contact.email_precontact_identity_fingerprint::text identity
    FROM lead_finder_private.email_suppression_hmac_key key
    CROSS JOIN public.lead_contacts contact
    WHERE key.singleton=true AND contact.id=${contactId}::uuid`;
  assert.deepEqual(recovered[0],{key_digest:manifest.precontactPermanent.keyDigest,identity:manifest.precontactPermanent.fingerprints[0]!});
  await sql.end();

  const dry=await reconcile(manifest,false,'ci-restore-precontact',url); assert.equal(dry.result,'SAFE'); assert.deepEqual(dry.precontactPermanent,{keyMatched:true,fingerprints:1,events:1,alreadyApplied:0,requiringChange:2,conflicts:0});
  await reconcile(manifest,true,'ci-restore-precontact',url); assert.equal(await verifyReconciliation(manifest,url),'RESTORE_SUPPRESSION_SAFE');
  sql=postgres(url,{max:1});
  const restored=await sql<{is_valid:boolean;suppressed:boolean;events:number}[]>`
    SELECT c.is_valid,i.suppressed,(SELECT count(*)::int FROM public.email_precontact_delivery_suppressions WHERE event_fingerprint=${eventFingerprint}::char(64)) events
    FROM lead_contacts c JOIN lead_finder_private.email_contact_identities i ON i.identity_fingerprint=c.email_precontact_identity_fingerprint
    WHERE c.id=${contactId}::uuid`;
  assert.deepEqual(restored[0],{is_valid:false,suppressed:true,events:1});
  await sql.end();

  const tamperedContent={...manifest,precontactPermanent:{...manifest.precontactPermanent,keyDigest:'0'.repeat(64)}}; const {digest:_,...withoutDigest}=tamperedContent; const tampered=validateManifestValue({...withoutDigest,digest:sha256(withoutDigest)}); const mismatch=await reconcile(tampered,false,'ci-restore-precontact',url); assert.equal(mismatch.result,'BLOCKED'); assert.equal(mismatch.reason,'PRECONTACT_SUPPRESSION_KEY_MISMATCH');
  process.stdout.write(JSON.stringify({gate:'RESTORE_PRECONTACT_PERMANENT',result:'PASS',staleRestorePreserved:true,emptyStateKeyRebaseSafe:true,pre0048NonEmptyKeyRecoverySafe:true,keyCapsulePrivate:true,rawAddressExported:false,keyMismatchFailsClosed:true})+'\n');
}finally{await sql.end().catch(()=>undefined);await rm(temp,{recursive:true,force:true});}
