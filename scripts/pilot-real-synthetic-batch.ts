import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type SyntheticLead = Readonly<{
  id: string;
  sourceRecordId: string;
  businessName: string;
  normalizedName: string;
  normalizedAddress: string;
  region: string;
  category: string;
  contactStatus: 'VALID' | 'INVALID' | 'ABSENT';
  websiteStatus: 'CONFIRMED_SITE' | 'INDICATED_NO_SITE';
  blocked?: boolean;
  optOut?: boolean;
  doNotContact?: boolean;
  origin: 'SYNTHETIC_FIXTURE_V1';
}>;

export type SyntheticBatchSummary = Readonly<{
  inputCount: number;
  eligibleCount: number;
  externalEffects: 0;
  rejectedByReason: Readonly<Record<string, number>>;
  eligibleIds: readonly string[];
}>;

const fixturePath = fileURLToPath(new URL('../fixtures/pilot-real/synthetic-leads-20.json', import.meta.url));

export async function loadSyntheticBatch(): Promise<SyntheticLead[]> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as SyntheticLead[];
}

const record = (target: Record<string, number>, reason: string) => {
  target[reason] = (target[reason] ?? 0) + 1;
};

export function validateSyntheticBatchFixture(leads: readonly SyntheticLead[]): void {
  if (leads.length !== 20) throw new Error('SYNTHETIC_BATCH_MUST_CONTAIN_EXACTLY_20_LEADS');
  if (new Set(leads.map((lead) => lead.id)).size !== 20) throw new Error('SYNTHETIC_BATCH_IDS_MUST_BE_UNIQUE');
  if (leads.some((lead) => lead.origin !== 'SYNTHETIC_FIXTURE_V1')) throw new Error('SYNTHETIC_BATCH_ORIGIN_REQUIRED');
  const expected = [
    leads.some((lead) => lead.blocked), leads.some((lead) => lead.optOut), leads.some((lead) => lead.doNotContact),
    leads.some((lead) => lead.contactStatus === 'INVALID'), leads.some((lead) => lead.contactStatus === 'ABSENT'),
    leads.some((lead) => lead.websiteStatus === 'CONFIRMED_SITE'), leads.some((lead) => lead.websiteStatus === 'INDICATED_NO_SITE'),
    new Set(leads.map((lead) => lead.sourceRecordId)).size < leads.length,
    new Set(leads.map((lead) => `${lead.normalizedName}|${lead.normalizedAddress}`)).size < leads.length,
    leads.some((lead) => lead.region !== 'Campinas/SP'), leads.some((lead) => lead.category !== 'oficinas'),
  ];
  if (expected.some((covered) => !covered)) throw new Error('SYNTHETIC_BATCH_REQUIRED_SCENARIO_MISSING');
}

export function evaluateSyntheticBatch(leads: readonly SyntheticLead[]): SyntheticBatchSummary {
  validateSyntheticBatchFixture(leads);
  const sourceRecords = new Set<string>();
  const normalizedRecords = new Set<string>();
  const eligibleIds: string[] = [];
  const rejectedByReason: Record<string, number> = {};
  for (const lead of leads) {
    const normalizedKey = `${lead.normalizedName}|${lead.normalizedAddress}`;
    if (sourceRecords.has(lead.sourceRecordId)) {
      record(rejectedByReason, 'DUPLICATE_EXACT');
      continue;
    }
    sourceRecords.add(lead.sourceRecordId);
    if (normalizedRecords.has(normalizedKey)) {
      record(rejectedByReason, 'DUPLICATE_NORMALIZED');
      continue;
    }
    normalizedRecords.add(normalizedKey);
    if (lead.blocked) record(rejectedByReason, 'BLOCKED');
    else if (lead.optOut) record(rejectedByReason, 'OPT_OUT');
    else if (lead.doNotContact) record(rejectedByReason, 'NAO_CONTATAR');
    else if (lead.region !== 'Campinas/SP') record(rejectedByReason, 'REGION_MISMATCH');
    else if (lead.category !== 'oficinas') record(rejectedByReason, 'CATEGORY_MISMATCH');
    else if (lead.contactStatus === 'INVALID') record(rejectedByReason, 'INVALID_CONTACT');
    else if (lead.contactStatus === 'ABSENT') record(rejectedByReason, 'CONTACT_ABSENT');
    else if (lead.websiteStatus === 'CONFIRMED_SITE') record(rejectedByReason, 'CONFIRMED_SITE');
    else eligibleIds.push(lead.id);
  }
  return { inputCount: leads.length, eligibleCount: eligibleIds.length, externalEffects: 0, rejectedByReason, eligibleIds };
}

export function materializeSyntheticBatch(summary: SyntheticBatchSummary, existingResourceIds = new Set<string>()) {
  const createdResourceIds = summary.eligibleIds
    .map((id) => `synthetic-pilot:${id}`)
    .filter((id) => !existingResourceIds.has(id));
  for (const id of createdResourceIds) existingResourceIds.add(id);
  return { createdResourceIds, resourceIds: [...existingResourceIds].sort() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = evaluateSyntheticBatch(await loadSyntheticBatch());
  const firstRun = materializeSyntheticBatch(summary);
  const secondRun = materializeSyntheticBatch(summary, new Set(firstRun.resourceIds));
  if (secondRun.createdResourceIds.length !== 0) throw new Error('SYNTHETIC_BATCH_RERUN_NOT_IDEMPOTENT');
  console.log(JSON.stringify({ summary, firstRunCreated: firstRun.createdResourceIds.length, rerunCreated: secondRun.createdResourceIds.length }, null, 2));
}
