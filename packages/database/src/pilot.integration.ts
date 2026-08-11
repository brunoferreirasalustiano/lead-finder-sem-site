import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { createAuthorizationContext } from '@lead-finder/shared';
import {
  addPilotLead, createPilotRun, getPilotSnapshot, recordPilotManualContact, recordPilotResult,
  reviewPilotLead, updatePilotRunStatus,
} from './pilot.js';
import { createDatabase } from './index.js';
import {
  campaignOptOuts, campaigns, crmTimelineEvents, leadContacts, leads, pilotIdempotencyKeys,
  pilotLeads, pilotManualContacts, pilotResults, pilotReviews, pilotRuns, pilotTimelineEvents,
} from './schema.js';

const expectCode = async (operation: Promise<unknown>, code: string) => assert.rejects(operation, (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code);

const isAppendOnlyViolation=(error:unknown):boolean=>{
  const visited=new Set<object>();
  let current=error;
  for(let depth=0;depth<32;depth+=1){
    if(typeof current!=='object'||current===null||visited.has(current))return false;
    visited.add(current);
    let code:unknown,cause:unknown;
    try{
      const candidate=current as {code?:unknown;cause?:unknown};
      code=candidate.code;cause=candidate.cause;
    }catch{return false;}
    if(code==='55000')return true;
    current=cause;
  }
  return false;
};

const assertAppendOnlyViolationRecognition=()=>{
  const direct={code:'55000'};
  assert.equal(isAppendOnlyViolation(direct),true);
  assert.equal(isAppendOnlyViolation({cause:direct}),true);
  assert.equal(isAppendOnlyViolation({cause:{cause:direct}}),true);
  assert.equal(isAppendOnlyViolation({message:'append-only'}),false);
  assert.equal(isAppendOnlyViolation({code:'23505',message:'append-only'}),false);
  assert.equal(isAppendOnlyViolation(null),false);
  assert.equal(isAppendOnlyViolation(undefined),false);
  assert.equal(isAppendOnlyViolation('append-only'),false);
  assert.equal(isAppendOnlyViolation(55000),false);
  assert.equal(isAppendOnlyViolation(true),false);
  assert.equal(isAppendOnlyViolation({cause:55000}),false);
  const cyclic:{cause?:unknown}={};cyclic.cause=cyclic;
  assert.equal(isAppendOnlyViolation(cyclic),false);
};

export async function runPilotPersistenceIntegration(databaseUrl: string) {
  assertAppendOnlyViolationRecognition();
  const { db, close } = createDatabase(databaseUrl);
  const auth=createAuthorizationContext({principalId:'pilot-integration',permissions:new Set(['pilot:write','pilot:review']),authenticationMethod:'integration'});
  const suffix=crypto.randomUUID();
  const fixturePhoneByLabel={
    funil:'+5511999900001',
    invalido:'+5511999900002',
    bloqueado:'+5511999900003',
    'metric-funnel':'+5511999900004',
    'metric-associated':'+5511999900005',
    concorrente:'+5511999900006',
    rollback:'+5511999900007',
    'review-race':'+5511999900008',
  } as const;
  const createLead=async(label:keyof typeof fixturePhoneByLabel)=>{
    const phone=fixturePhoneByLabel[label];
    const lead=(await db.insert(leads).values({osmType:'node',osmId:`pilot-${label}-${suffix}`,name:`Empresa Ficticia ${label}`,category:'Categoria Ficticia',city:'Regiao Ficticia',state:'XX',score:1,status:'SEM_SITE_CADASTRADO',qualificationStatus:'SEM_SITE_CONFIRMADO',websiteStatus:'NO_OFFICIAL_SITE_CONFIRMED'}).returning())[0]!;
    const contacts=await db.insert(leadContacts).values([
      {leadId:lead.id,type:'EMAIL',originalValue:`${label}@example.invalid`,normalizedValue:`${label}@example.invalid`,source:'SYNTHETIC',confidence:'1',verifiedAt:new Date(),isValid:true},
      {leadId:lead.id,type:'TELEFONE',originalValue:phone,normalizedValue:phone,source:'SYNTHETIC',confidence:'1',verifiedAt:new Date(),isValid:true},
    ]).returning();
    return {lead,email:contacts[0]!,phone:contacts[1]!};
  };
  const metricFixtureFingerprint=(value:string)=>createHash('sha256').update(value).digest('hex');
  // Isolated SQL fixture for PostgreSQL timestamp precision; this is not an operational API.
  const insertMetricResultFixture=async(input:{pilotRunId:string;leadId:string;result:string;recordedAtText:string;version:number;humanConfirmed?:boolean}):Promise<string>=>{
    const idempotencyKey=`metric-result-${input.leadId}-${input.version}-${suffix}`;
    const rows=await db.execute(sql<{id:string}[]>`insert into pilot_results
      (pilot_run_id,lead_id,result,principal_id,recorded_at,human_confirmed,version,idempotency_key,payload_fingerprint)
      values (${input.pilotRunId}::uuid,${input.leadId}::uuid,${input.result},${'metric-fixture'},${input.recordedAtText}::timestamptz,
        ${input.humanConfirmed===true},${input.version},${idempotencyKey},${metricFixtureFingerprint(idempotencyKey)}) returning id`);
    const id=rows[0]?.id;if(typeof id!=='string')throw new Error('Metric result fixture insert did not return an id');return id;
  };
  const insertMetricManualContactFixture=async(input:{pilotRunId:string;leadId:string;contactId:string;recordedAtText:string}):Promise<string>=>{
    const idempotencyKey=`metric-contact-${input.leadId}-${suffix}`;
    const rows=await db.execute(sql<{id:string}[]>`insert into pilot_manual_contacts
      (pilot_run_id,lead_id,contact_id,channel,approved_template_version_id,operator_principal_id,recorded_at,idempotency_key,payload_fingerprint)
      values (${input.pilotRunId}::uuid,${input.leadId}::uuid,${input.contactId}::uuid,${'PHONE'},${'metric-template-v1'},${'metric-fixture'},
        ${input.recordedAtText}::timestamptz,${idempotencyKey},${metricFixtureFingerprint(idempotencyKey)}) returning id`);
    const id=rows[0]?.id;if(typeof id!=='string')throw new Error('Metric manual-contact fixture insert did not return an id');return id;
  };
  const expectAppendOnly=async(operation:Promise<unknown>)=>assert.rejects(operation,isAppendOnlyViolation);
  try {
    const required=['pilot_runs','pilot_leads','pilot_reviews','pilot_manual_contacts','pilot_results','pilot_timeline_events','pilot_idempotency_keys'];
    for(const table of required){const rows=await db.execute(sql<{present:boolean}[]>`select to_regclass(${`public.${table}`}) is not null present`);assert.equal(rows[0]?.present,true,`missing pilot table: ${table}`);}

    const key=`pilot-integration-${suffix}`;
    const input={name:'Synthetic Pilot',region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:3,idempotencyKey:key};
    const created=await createPilotRun(db,input,auth);
    const expectReviewRejectedWithoutChanges=async(label:string,pilotRunId:string,leadId:string,expectedVersion:number)=>{
      const idempotencyKey=`${key}-review-${label}`;
      const reviewCountBefore=(await db.select({value:count()}).from(pilotReviews).where(and(eq(pilotReviews.pilotRunId,pilotRunId),eq(pilotReviews.leadId,leadId))))[0]!.value;
      const eventCountBefore=(await db.select({value:count()}).from(pilotTimelineEvents).where(and(eq(pilotTimelineEvents.pilotRunId,pilotRunId),eq(pilotTimelineEvents.leadId,leadId),eq(pilotTimelineEvents.eventType,'PILOT_REVIEW_RECORDED'))))[0]!.value;
      await expectCode(reviewPilotLead(db,pilotRunId,leadId,{decision:'REJECTED',reason:'Revisao sintetica bloqueada',expectedVersion,idempotencyKey},auth),'INVALID_STATE');
      assert.equal((await db.select({value:count()}).from(pilotReviews).where(and(eq(pilotReviews.pilotRunId,pilotRunId),eq(pilotReviews.leadId,leadId))))[0]!.value,reviewCountBefore);
      assert.equal((await db.select({value:count()}).from(pilotTimelineEvents).where(and(eq(pilotTimelineEvents.pilotRunId,pilotRunId),eq(pilotTimelineEvents.leadId,leadId),eq(pilotTimelineEvents.eventType,'PILOT_REVIEW_RECORDED'))))[0]!.value,eventCountBefore);
      assert.equal((await db.select({value:count()}).from(pilotIdempotencyKeys).where(and(eq(pilotIdempotencyKeys.scope,`review:${pilotRunId}:${leadId}`),eq(pilotIdempotencyKeys.idempotencyKey,idempotencyKey))))[0]!.value,0);
    };
    assert.equal((await createPilotRun(db,input,auth)).replayed,true);
    await expectCode(createPilotRun(db,{...input,name:'Divergent Synthetic Pilot'},auth),'IDEMPOTENCY_CONFLICT');

    const funnel=await createLead('funil'); const invalid=await createLead('invalido'); const dnc=await createLead('bloqueado');
    for(const [index,item] of [funnel,invalid,dnc].entries()){
      await addPilotLead(db,created.data.id,{leadId:item.lead.id,source:'SYNTHETIC',expectedVersion:index+1,idempotencyKey:`${key}-lead-${index}`},auth);
      const review=await reviewPilotLead(db,created.data.id,item.lead.id,{decision:'APPROVED',expectedVersion:0,idempotencyKey:`${key}-review-${index}`},auth);
      assert.equal(review.data.decision,'APPROVED','reviews must remain available while the pilot is in draft');
    }
    await expectCode(updatePilotRunStatus(db,created.data.id,{status:'READY',expectedVersion:4,idempotencyKey:`${key}-ready-false`},auth,{shadowModeEnabled:false,realProviderConfigured:false,collectionEgressEnabled:false}),'INVALID_STATE');
    const forgedCampaign=(await db.insert(campaigns).values({name:'Campanha sintetica sem prova',idempotencyKey:`${key}-campaign`,payloadFingerprint:'f'.repeat(64)}).returning())[0]!;
    await db.update(pilotRuns).set({campaignId:forgedCampaign.id}).where(eq(pilotRuns.id,created.data.id));
    await expectCode(updatePilotRunStatus(db,created.data.id,{status:'READY',expectedVersion:4,idempotencyKey:`${key}-ready-campaign`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false}),'INVALID_STATE');
    await db.update(pilotRuns).set({campaignId:null}).where(eq(pilotRuns.id,created.data.id));
    await updatePilotRunStatus(db,created.data.id,{status:'READY',expectedVersion:4,idempotencyKey:`${key}-ready`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false});
    await expectReviewRejectedWithoutChanges('ready',created.data.id,dnc.lead.id,1);
    await updatePilotRunStatus(db,created.data.id,{status:'RUNNING',expectedVersion:5,idempotencyKey:`${key}-running`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false});
    await expectReviewRejectedWithoutChanges('running',created.data.id,dnc.lead.id,1);

    for(const result of ['CONTACTED','RESPONDED','INTERESTED','PROPOSAL_REQUESTED'] as const)
      await expectCode(recordPilotResult(db,created.data.id,funnel.lead.id,{result,expectedVersion:0,idempotencyKey:`${key}-blocked-${result}`},auth),'INVALID_STATE');
    const notContacted=await recordPilotResult(db,created.data.id,funnel.lead.id,{result:'NOT_CONTACTED',expectedVersion:0,idempotencyKey:`${key}-not-contacted`},auth);
    assert.equal(notContacted.data.result,'NOT_CONTACTED');
    await recordPilotManualContact(db,created.data.id,funnel.lead.id,{contactId:funnel.phone.id,channel:'PHONE',approvedTemplateVersionId:'synthetic-template-v1',expectedVersion:1,idempotencyKey:`${key}-manual`},auth);
    const sequence=['CONTACTED','RESPONDED','INTERESTED','MEETING_REQUESTED','PROPOSAL_REQUESTED'] as const;
    let version=1;
    for(const result of sequence){await recordPilotResult(db,created.data.id,funnel.lead.id,{result,expectedVersion:version,idempotencyKey:`${key}-${result}`},auth);version+=1;}
    const conversionCommand={result:'CONVERTED' as const,humanConfirmedConversion:true as const,expectedVersion:version,idempotencyKey:`${key}-converted`};
    await recordPilotResult(db,created.data.id,funnel.lead.id,conversionCommand,auth);

    await expectCode(recordPilotResult(db,created.data.id,invalid.lead.id,{result:'INVALID_CONTACT',contactId:funnel.email.id,reason:'Contato sintetico de outro lead',expectedVersion:0,idempotencyKey:`${key}-cross-contact`},auth),'INELIGIBLE_LEAD');
    await expectCode(recordPilotResult(db,created.data.id,invalid.lead.id,{result:'INVALID_CONTACT',contactId:crypto.randomUUID(),reason:'Contato sintetico forjado',expectedVersion:0,idempotencyKey:`${key}-forged-contact`},auth),'INELIGIBLE_LEAD');
    const invalidCommand={result:'INVALID_CONTACT' as const,contactId:invalid.email.id,reason:'Email sintetico invalido',expectedVersion:0,idempotencyKey:`${key}-invalid-contact`};
    const invalidResult=await recordPilotResult(db,created.data.id,invalid.lead.id,invalidCommand,auth);
    assert.equal((await recordPilotResult(db,created.data.id,invalid.lead.id,invalidCommand,auth)).replayed,true);
    await expectCode(recordPilotResult(db,created.data.id,invalid.lead.id,{...invalidCommand,reason:'Payload divergente'},auth),'IDEMPOTENCY_CONFLICT');
    const preserved=await db.select().from(leadContacts).where(eq(leadContacts.leadId,invalid.lead.id));
    assert.equal(preserved.find(contact=>contact.id===invalid.email.id)?.isValid,false);
    assert.equal(preserved.find(contact=>contact.id===invalid.phone.id)?.isValid,true);
    assert.equal(preserved.find(contact=>contact.id===invalid.email.id)?.originalValue,invalid.email.originalValue);
    assert.equal(preserved.find(contact=>contact.id===invalid.email.id)?.normalizedValue,invalid.email.normalizedValue);
    assert.equal(preserved.find(contact=>contact.id===invalid.email.id)?.source,invalid.email.source);
    assert.equal((await db.select({value:count()}).from(pilotTimelineEvents).where(and(eq(pilotTimelineEvents.pilotRunId,created.data.id),eq(pilotTimelineEvents.leadId,invalid.lead.id),eq(pilotTimelineEvents.eventType,'PILOT_RESULT_RECORDED'))))[0]?.value,1);
    assert.ok(invalidResult.data.id);

    await recordPilotResult(db,created.data.id,dnc.lead.id,{result:'DO_NOT_CONTACT',reason:'Decisao humana sintetica',expectedVersion:0,idempotencyKey:`${key}-dnc`},auth);
    const blocked=(await db.select().from(leads).where(eq(leads.id,dnc.lead.id)).limit(1))[0]!;
    assert.deepEqual({isBlocked:blocked.isBlocked,doNotContact:blocked.doNotContact,crmStage:blocked.crmStage},{isBlocked:true,doNotContact:true,crmStage:'NAO_CONTATAR'});
    assert.equal((await db.select({value:count()}).from(campaignOptOuts).where(eq(campaignOptOuts.leadId,dnc.lead.id)))[0]?.value,1);
    assert.equal((await db.select({value:count()}).from(crmTimelineEvents).where(and(eq(crmTimelineEvents.leadId,dnc.lead.id),eq(crmTimelineEvents.eventType,'DO_NOT_CONTACT'))))[0]?.value,1);

    const operationalResultsBeforeReplay=(await db.select({value:count()}).from(pilotResults).where(eq(pilotResults.pilotRunId,created.data.id)))[0]!.value;
    const operationalTimelineBeforeReplay=(await db.select({value:count()}).from(pilotTimelineEvents).where(eq(pilotTimelineEvents.pilotRunId,created.data.id)))[0]!.value;
    assert.equal((await recordPilotResult(db,created.data.id,funnel.lead.id,conversionCommand,auth)).replayed,true);
    assert.equal((await db.select({value:count()}).from(pilotResults).where(eq(pilotResults.pilotRunId,created.data.id)))[0]!.value,operationalResultsBeforeReplay);
    assert.equal((await db.select({value:count()}).from(pilotTimelineEvents).where(eq(pilotTimelineEvents.pilotRunId,created.data.id)))[0]!.value,operationalTimelineBeforeReplay);

    const metricRun=(await db.insert(pilotRuns).values({name:'Metric Precision Fixture',region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:2,status:'RUNNING',createdBy:'metric-fixture',startedAt:new Date('2026-07-16T23:59:59.000Z')}).returning())[0]!;
    const metricFunnel=await createLead('metric-funnel');
    const metricAssociated=await createLead('metric-associated');
    await db.insert(pilotLeads).values([
      {pilotRunId:metricRun.id,leadId:metricFunnel.lead.id,source:'SYNTHETIC',addedBy:'metric-fixture'},
      {pilotRunId:metricRun.id,leadId:metricAssociated.lead.id,source:'SYNTHETIC',addedBy:'metric-fixture'},
    ]);
    await db.insert(pilotReviews).values([
      {pilotRunId:metricRun.id,leadId:metricFunnel.lead.id,decision:'APPROVED',reviewerPrincipalId:'metric-fixture',version:1},
      {pilotRunId:metricRun.id,leadId:metricAssociated.lead.id,decision:'APPROVED',reviewerPrincipalId:'metric-fixture',version:1},
    ]);
    const metricManualContactId=await insertMetricManualContactFixture({pilotRunId:metricRun.id,leadId:metricFunnel.lead.id,contactId:metricFunnel.phone.id,recordedAtText:'2026-07-16T23:59:59.998999Z'});
    const metricResultIds:string[]=[];
    const metricEvents=[
      ['CONTACTED','2026-07-16T23:59:59.998999Z',false],
      ['RESPONDED','2026-07-16T23:59:59.999000Z',false],
      ['INTERESTED','2026-07-17T00:00:00.000123Z',false],
      ['MEETING_REQUESTED','2026-07-17T00:00:00.050000Z',false],
      ['PROPOSAL_REQUESTED','2026-07-17T00:00:00.123100Z',false],
      ['CONVERTED','2026-07-17T00:00:00.123456Z',true],
    ] as const;
    let metricVersion=1;
    for(const [result,recordedAtText,humanConfirmed] of metricEvents){
      metricResultIds.push(await insertMetricResultFixture({pilotRunId:metricRun.id,leadId:metricFunnel.lead.id,result,recordedAtText,version:metricVersion,humanConfirmed}));
      metricVersion+=1;
    }
    await insertMetricResultFixture({pilotRunId:metricRun.id,leadId:metricAssociated.lead.id,result:'INVALID_CONTACT',recordedAtText:'2026-07-17T00:00:00.124000Z',version:1});

    const metricFrom=new Date('2026-07-16T23:59:59.999Z'),metricTo=new Date('2026-07-17T00:00:00.123Z');
    const snapshot=await getPilotSnapshot(db,metricRun.id,{from:metricFrom,to:metricTo});
    assert.deepEqual({responses:snapshot.counts.totalResponses,interested:snapshot.counts.totalInterested,meetings:snapshot.counts.totalMeetingRequested,proposals:snapshot.counts.totalProposalRequested,conversions:snapshot.counts.totalConversions},{responses:1,interested:1,meetings:1,proposals:1,conversions:1});
    assert.equal(snapshot.counts.totalManualContacts,0,'an event before the lower bound must be excluded');
    assert.equal(snapshot.counts.totalInvalidContacts,0,'an event in the millisecond after the upper bound must be excluded');
    assert.equal(snapshot.counts.totalAssociated,2,'two associated leads must be counted separately');
    assert.equal((await db.execute(sql<{human_confirmed:boolean}[]>`select human_confirmed from pilot_results where id=${metricResultIds.at(-1)!}::uuid`))[0]!.human_confirmed,true);
    const lowerMillisecond=await getPilotSnapshot(db,metricRun.id,{from:metricFrom,to:metricFrom});
    assert.equal(lowerMillisecond.counts.totalResponses,1,'an event exactly at the lower bound must be included');
    const singleMillisecond=await getPilotSnapshot(db,metricRun.id,{from:metricTo,to:metricTo});
    assert.equal(singleMillisecond.counts.totalConversions,1,'from = to must include events with additional microseconds in that millisecond');
    assert.equal(Object.values(snapshot.rates).every(rate=>rate.value===null||rate.value<=1),true);
    assert.doesNotMatch(JSON.stringify(snapshot),/example\.invalid|\+5500|Empresa Ficticia|name|phone|email|address|cnpj|message/i,'snapshot must not expose PII');
    const before=await getPilotSnapshot(db,metricRun.id,{from:new Date(0),to:new Date(metricFrom.getTime()-1)});
    assert.equal(before.counts.totalResponses,0,'events before the period must not be counted');
    const after=await getPilotSnapshot(db,metricRun.id,{from:new Date(metricTo.getTime()+1),to:new Date(metricTo.getTime()+60_000)});
    assert.equal(after.counts.totalResponses,0,'events after the period must not be counted');
    assert.equal(after.rates.response.value,null,'zero denominator must remain null');

    const raceLead=await createLead('concorrente');
    const raceRuns=await Promise.all([0,1].map(index=>createPilotRun(db,{name:`Race ${index}`,region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:1,idempotencyKey:`${key}-race-run-${index}`},auth)));
    const race=await Promise.allSettled(raceRuns.map((run,index)=>addPilotLead(db,run.data.id,{leadId:raceLead.lead.id,source:'SYNTHETIC',expectedVersion:1,idempotencyKey:`${key}-race-lead-${index}`},auth)));
    assert.equal(race.filter(result=>result.status==='fulfilled').length,1,'one lead must belong to only one active pilot');
    assert.equal(race.filter(result=>result.status==='rejected'&&result.reason instanceof Error&&'code' in result.reason&&result.reason.code==='LOGICAL_CONFLICT').length,1,'the losing operation must return a logical conflict');
    assert.equal((await db.select({value:count()}).from(pilotLeads).where(eq(pilotLeads.leadId,raceLead.lead.id)))[0]!.value,1,'the losing operation must not leave a partial association');

    const reviewRaceLead=await createLead('review-race');
    const reviewRaceRun=await createPilotRun(db,{name:'Review Race Pilot',region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:1,idempotencyKey:`${key}-review-race-run`},auth);
    await addPilotLead(db,reviewRaceRun.data.id,{leadId:reviewRaceLead.lead.id,source:'SYNTHETIC',expectedVersion:1,idempotencyKey:`${key}-review-race-lead`},auth);
    await reviewPilotLead(db,reviewRaceRun.data.id,reviewRaceLead.lead.id,{decision:'APPROVED',expectedVersion:0,idempotencyKey:`${key}-review-race-approved`},auth);
    const reviewRaceReviewsBefore=(await db.select({value:count()}).from(pilotReviews).where(and(eq(pilotReviews.pilotRunId,reviewRaceRun.data.id),eq(pilotReviews.leadId,reviewRaceLead.lead.id))))[0]!.value;
    const reviewRaceTimelineBefore=(await db.select({value:count()}).from(pilotTimelineEvents).where(eq(pilotTimelineEvents.pilotRunId,reviewRaceRun.data.id)))[0]!.value;
    const reviewRaceReviewKey=`${key}-review-race-rejected`,reviewRaceStatusKey=`${key}-review-race-ready`;
    const competingDatabase=createDatabase(databaseUrl);
    let reviewStatusRace:PromiseSettledResult<unknown>[]=[];
    try{
      reviewStatusRace=await Promise.allSettled([
        reviewPilotLead(db,reviewRaceRun.data.id,reviewRaceLead.lead.id,{decision:'REJECTED',reason:'Revisao sintetica concorrente',expectedVersion:1,idempotencyKey:reviewRaceReviewKey},auth),
        updatePilotRunStatus(competingDatabase.db,reviewRaceRun.data.id,{status:'READY',expectedVersion:2,idempotencyKey:reviewRaceStatusKey},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false}),
      ]);
    }finally{await competingDatabase.close();}
    assert.equal(reviewStatusRace.filter(result=>result.status==='fulfilled').length,1,'review and READY transition must have exactly one winner');
    assert.equal(reviewStatusRace.filter(result=>result.status==='rejected'&&result.reason instanceof Error&&'code' in result.reason&&result.reason.code==='INVALID_STATE').length,1,'the losing operation must fail with a logical pilot state error');
    const reviewRaceFinalRun=(await db.select().from(pilotRuns).where(eq(pilotRuns.id,reviewRaceRun.data.id)).limit(1))[0]!;
    const reviewRaceFinalReviews=await db.select().from(pilotReviews).where(and(eq(pilotReviews.pilotRunId,reviewRaceRun.data.id),eq(pilotReviews.leadId,reviewRaceLead.lead.id))).orderBy(desc(pilotReviews.version));
    const reviewRaceReviewKeys=(await db.select({value:count()}).from(pilotIdempotencyKeys).where(and(eq(pilotIdempotencyKeys.scope,`review:${reviewRaceRun.data.id}:${reviewRaceLead.lead.id}`),eq(pilotIdempotencyKeys.idempotencyKey,reviewRaceReviewKey))))[0]!.value;
    const reviewRaceStatusKeys=(await db.select({value:count()}).from(pilotIdempotencyKeys).where(and(eq(pilotIdempotencyKeys.scope,`status:${reviewRaceRun.data.id}`),eq(pilotIdempotencyKeys.idempotencyKey,reviewRaceStatusKey))))[0]!.value;
    assert.equal((await db.select({value:count()}).from(pilotTimelineEvents).where(eq(pilotTimelineEvents.pilotRunId,reviewRaceRun.data.id)))[0]!.value,reviewRaceTimelineBefore+1,'the losing operation must not leave a partial timeline event');
    if(reviewRaceFinalRun.status==='READY'){
      assert.equal(reviewRaceFinalReviews.length,reviewRaceReviewsBefore);assert.equal(reviewRaceFinalReviews[0]!.decision,'APPROVED');assert.equal(reviewRaceReviewKeys,0);assert.equal(reviewRaceStatusKeys,1);
      assert.equal((await updatePilotRunStatus(db,reviewRaceRun.data.id,{status:'READY',expectedVersion:2,idempotencyKey:reviewRaceStatusKey},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false})).replayed,true);
    }else{
      assert.equal(reviewRaceFinalRun.status,'DRAFT');assert.equal(reviewRaceFinalReviews.length,reviewRaceReviewsBefore+1);assert.equal(reviewRaceFinalReviews[0]!.decision,'REJECTED');assert.equal(reviewRaceReviewKeys,1);assert.equal(reviewRaceStatusKeys,0);
      assert.equal((await reviewPilotLead(db,reviewRaceRun.data.id,reviewRaceLead.lead.id,{decision:'REJECTED',reason:'Revisao sintetica concorrente',expectedVersion:1,idempotencyKey:reviewRaceReviewKey},auth)).replayed,true);
    }
    assert.equal((await db.select({value:count()}).from(pilotReviews).where(and(eq(pilotReviews.pilotRunId,reviewRaceRun.data.id),eq(pilotReviews.leadId,reviewRaceLead.lead.id))))[0]!.value,reviewRaceFinalReviews.length,'replay must not duplicate a review');
    assert.equal((await db.select({value:count()}).from(pilotTimelineEvents).where(eq(pilotTimelineEvents.pilotRunId,reviewRaceRun.data.id)))[0]!.value,reviewRaceTimelineBefore+1,'replay must not duplicate a timeline event');

    const rollbackRun=await createPilotRun(db,{name:'Rollback Pilot',region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:1,idempotencyKey:`${key}-rollback-run`},auth);
    const rollbackLead=await createLead('rollback');
    await addPilotLead(db,rollbackRun.data.id,{leadId:rollbackLead.lead.id,source:'SYNTHETIC',expectedVersion:1,idempotencyKey:`${key}-rollback-lead`},auth);
    await reviewPilotLead(db,rollbackRun.data.id,rollbackLead.lead.id,{decision:'APPROVED',expectedVersion:0,idempotencyKey:`${key}-rollback-review`},auth);
    await updatePilotRunStatus(db,rollbackRun.data.id,{status:'READY',expectedVersion:2,idempotencyKey:`${key}-rollback-ready`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false});
    await updatePilotRunStatus(db,rollbackRun.data.id,{status:'RUNNING',expectedVersion:3,idempotencyKey:`${key}-rollback-running`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false});
    await db.execute(sql`create or replace function pilot_test_fail_result() returns trigger language plpgsql as $$ begin raise exception 'synthetic rollback'; end $$`);
    try {
      await db.execute(sql`create trigger pilot_test_fail_result before insert on pilot_results for each row when (new.idempotency_key like 'rollback-failure-%') execute function pilot_test_fail_result()`);
      await assert.rejects(recordPilotResult(db,rollbackRun.data.id,rollbackLead.lead.id,{result:'DO_NOT_CONTACT',reason:'Rollback sintetico',expectedVersion:0,idempotencyKey:`rollback-failure-${suffix}`},auth));
    } finally {
      await db.execute(sql`drop trigger if exists pilot_test_fail_result on pilot_results`);
      await db.execute(sql`drop function if exists pilot_test_fail_result()`);
    }
    const rolledBack=(await db.select().from(leads).where(eq(leads.id,rollbackLead.lead.id)).limit(1))[0]!;
    assert.deepEqual({isBlocked:rolledBack.isBlocked,doNotContact:rolledBack.doNotContact,crmStage:rolledBack.crmStage},{isBlocked:false,doNotContact:false,crmStage:null});
    assert.equal((await db.select({value:count()}).from(campaignOptOuts).where(eq(campaignOptOuts.leadId,rollbackLead.lead.id)))[0]?.value,0);
    assert.equal((await db.select({value:count()}).from(pilotResults).where(eq(pilotResults.leadId,rollbackLead.lead.id)))[0]?.value,0);
    assert.equal((await db.select({value:count()}).from(pilotTimelineEvents).where(and(eq(pilotTimelineEvents.pilotRunId,rollbackRun.data.id),eq(pilotTimelineEvents.leadId,rollbackLead.lead.id),eq(pilotTimelineEvents.eventType,'PILOT_RESULT_RECORDED'))))[0]!.value,0);
    assert.equal((await db.select({value:count()}).from(pilotIdempotencyKeys).where(and(eq(pilotIdempotencyKeys.scope,`result:${rollbackRun.data.id}`),eq(pilotIdempotencyKeys.idempotencyKey,`rollback-failure-${suffix}`))))[0]!.value,0);

    await updatePilotRunStatus(db,created.data.id,{status:'CANCELLED',expectedVersion:6,idempotencyKey:`${key}-cancelled`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false});
    await expectReviewRejectedWithoutChanges('cancelled',created.data.id,dnc.lead.id,1);

    const appendOnlyResult=(await db.select().from(pilotResults).where(eq(pilotResults.id,metricResultIds[0]!)).limit(1))[0]!;
    const appendOnlyContact=(await db.select().from(pilotManualContacts).where(eq(pilotManualContacts.id,metricManualContactId)).limit(1))[0]!;
    const event=(await db.select().from(pilotTimelineEvents).where(eq(pilotTimelineEvents.pilotRunId,created.data.id)).limit(1))[0]!;
    await expectAppendOnly(db.execute(sql`update pilot_results set recorded_at=recorded_at where id=${metricResultIds[0]!}::uuid`));
    await expectAppendOnly(db.execute(sql`delete from pilot_results where id=${metricResultIds[0]!}::uuid`));
    await expectAppendOnly(db.execute(sql`update pilot_manual_contacts set recorded_at=recorded_at where id=${metricManualContactId}::uuid`));
    await expectAppendOnly(db.execute(sql`delete from pilot_manual_contacts where id=${metricManualContactId}::uuid`));
    await expectAppendOnly(db.update(pilotTimelineEvents).set({eventType:'FORGED'}).where(eq(pilotTimelineEvents.id,event.id)));
    await expectAppendOnly(db.delete(pilotTimelineEvents).where(eq(pilotTimelineEvents.id,event.id)));
    assert.deepEqual((await db.select().from(pilotResults).where(eq(pilotResults.id,appendOnlyResult.id)).limit(1))[0],appendOnlyResult);
    assert.deepEqual((await db.select().from(pilotManualContacts).where(eq(pilotManualContacts.id,appendOnlyContact.id)).limit(1))[0],appendOnlyContact);
    assert.deepEqual((await db.select().from(pilotTimelineEvents).where(eq(pilotTimelineEvents.id,event.id)).limit(1))[0],event);
    assert.ok((await db.select({value:count()}).from(pilotManualContacts).where(eq(pilotManualContacts.pilotRunId,created.data.id)))[0]!.value>0);
    assert.ok((await db.select({value:count()}).from(pilotIdempotencyKeys).where(eq(pilotIdempotencyKeys.scope,`result:${created.data.id}`)))[0]!.value>0);
  } finally { await close(); }
}
