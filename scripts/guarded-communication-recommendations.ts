import { mkdir, writeFile } from 'node:fs/promises';
import {
  communicationChannels,
  communicationNiches,
  generateExtendedCommunicationCases,
  opportunityStates,
  summarizeCommunicationExperiment,
  type CommunicationChannel,
  type CommunicationEvaluation,
  type CommunicationNiche,
  type OpportunityState,
} from '../packages/messaging/src/communication-lab.js';
import {
  communicationRequiresDiagnosticEvidence,
  evaluateGuardedCommunicationVariant,
} from '../packages/messaging/src/communication-evidence-guards.js';

const outputDirectory = process.env.COMMUNICATION_LAB_OUTPUT_DIR ?? 'artifacts/communication-lab';
const variants = generateExtendedCommunicationCases();

const evaluations = variants.map((variant) =>
  evaluateGuardedCommunicationVariant(variant, {
    diagnosticEvidence: communicationRequiresDiagnosticEvidence(variant) ? 'VERIFIED' : 'NOT_APPLICABLE',
  }),
);

const coldAcquisitionChannels = new Set<CommunicationChannel>(['EMAIL', 'CONTACT_FORM', 'BUSINESS_DM']);
const postOptInChannels = new Set<CommunicationChannel>(['WHATSAPP_OPT_IN']);

type RecommendationStage = 'COLD_ACQUISITION' | 'POST_OPT_IN' | 'ALL_GUARDED';

function evaluationsForStage(stage: RecommendationStage): CommunicationEvaluation[] {
  if (stage === 'COLD_ACQUISITION') {
    return evaluations.filter((evaluation) => coldAcquisitionChannels.has(evaluation.variant.channel));
  }
  if (stage === 'POST_OPT_IN') {
    return evaluations.filter((evaluation) => postOptInChannels.has(evaluation.variant.channel));
  }
  return evaluations;
}

function serializeEvaluation(evaluation: CommunicationEvaluation) {
  return {
    id: evaluation.variant.id,
    score: evaluation.score,
    channel: evaluation.variant.channel,
    niche: evaluation.variant.niche,
    opportunity: evaluation.variant.opportunity,
    opening: evaluation.variant.opening,
    tone: evaluation.variant.tone,
    cta: evaluation.variant.cta,
    personalization: evaluation.variant.personalization,
    optOut: evaluation.variant.optOut,
    linkPolicy: evaluation.variant.linkPolicy,
    authorization: evaluation.variant.authorization,
    sourceType: evaluation.variant.sourceType,
    diagnosticEvidenceRequired: communicationRequiresDiagnosticEvidence(evaluation.variant),
  };
}

function rankEligible(items: readonly CommunicationEvaluation[]) {
  return items
    .filter((evaluation) => evaluation.eligible)
    .sort((left, right) => right.score - left.score || left.variant.id.localeCompare(right.variant.id));
}

function topForChannel(items: readonly CommunicationEvaluation[], channel: CommunicationChannel, limit = 10) {
  return rankEligible(items)
    .filter((evaluation) => evaluation.variant.channel === channel)
    .slice(0, limit)
    .map(serializeEvaluation);
}

function topForStage(items: readonly CommunicationEvaluation[], limit = 20) {
  return rankEligible(items).slice(0, limit).map(serializeEvaluation);
}

function topForNiche(items: readonly CommunicationEvaluation[], niche: CommunicationNiche, limit = 3) {
  return rankEligible(items)
    .filter((evaluation) => evaluation.variant.niche === niche)
    .slice(0, limit)
    .map(serializeEvaluation);
}

function topForOpportunity(items: readonly CommunicationEvaluation[], opportunity: OpportunityState, limit = 3) {
  return rankEligible(items)
    .filter((evaluation) => evaluation.variant.opportunity === opportunity)
    .slice(0, limit)
    .map(serializeEvaluation);
}

function countValues(items: readonly CommunicationEvaluation[], field: 'codes' | 'warnings') {
  const counts = new Map<string, number>();
  for (const evaluation of items) {
    for (const value of evaluation[field]) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

function createStageReport(stage: RecommendationStage) {
  const items = evaluationsForStage(stage);
  const summary = summarizeCommunicationExperiment(items);
  const allowedChannels = stage === 'COLD_ACQUISITION'
    ? communicationChannels.filter((channel) => coldAcquisitionChannels.has(channel))
    : stage === 'POST_OPT_IN'
      ? communicationChannels.filter((channel) => postOptInChannels.has(channel))
      : communicationChannels;
  const topByChannel = Object.fromEntries(
    allowedChannels.map((channel) => [channel, topForChannel(items, channel)]),
  );
  const topByNiche = Object.fromEntries(
    communicationNiches.map((niche) => [niche, topForNiche(items, niche)]),
  );
  const topByOpportunity = Object.fromEntries(
    opportunityStates.map((opportunity) => [opportunity, topForOpportunity(items, opportunity)]),
  );
  const topVariants = topForStage(items);
  return {
    stage,
    summary,
    blockedReasons: countValues(items, 'codes'),
    warnings: countValues(items, 'warnings'),
    topByChannel,
    topByNiche,
    topByOpportunity,
    topVariants,
    guardedPatterns: {
      opening: summary.byOpening[0]?.key ?? null,
      tone: summary.byTone[0]?.key ?? null,
      cta: summary.byCta[0]?.key ?? null,
      channel: summary.byChannel[0]?.key ?? null,
      requiresVerifiedDiagnosticEvidence:
        summary.byOpening[0]?.key === 'DIAGNOSIS_FIRST' ||
        topVariants.some((item) => item.personalization === 'DIAGNOSIS'),
    },
  };
}

const stages = {
  COLD_ACQUISITION: createStageReport('COLD_ACQUISITION'),
  POST_OPT_IN: createStageReport('POST_OPT_IN'),
  ALL_GUARDED: createStageReport('ALL_GUARDED'),
};

const report = {
  metadata: {
    schemaVersion: 'v3',
    commit: process.env.GITHUB_HEAD_SHA ?? process.env.GITHUB_SHA ?? 'local',
    simulatedOnly: true,
    realConversionEvidence: false,
    externalEffects: { providers: false, messages: false, webhooks: false, writes: false },
    evaluatedRecommendationScenarios: evaluations.length,
    stratification: {
      niches: communicationNiches.length,
      opportunities: opportunityStates.length,
      recommendationsPerGroup: 3,
    },
  },
  stages,
  interpretation: [
    'COLD_ACQUISITION contém somente e-mail, formulário empresarial e DM empresarial.',
    'POST_OPT_IN contém somente WhatsApp com autorização válida já registrada.',
    'ALL_GUARDED é uma visão técnica consolidada e não deve ser usada para escolher o primeiro canal.',
    'topByNiche e topByOpportunity evitam que empates de score escondam segmentos ou diagnósticos.',
    'DIAGNOSIS_FIRST e personalização DIAGNOSIS são condicionais a evidência VERIFIED.',
    'Scores sintéticos não representam taxa real de resposta ou conversão.',
    'Nenhuma variante autoriza envio automático ou WhatsApp sem opt-in.',
  ],
};

const cold = stages.COLD_ACQUISITION;
const postOptIn = stages.POST_OPT_IN;
const markdown = [
  '# Recomendações sintéticas por estágio',
  '',
  `- Cenários guardados avaliados: **${report.metadata.evaluatedRecommendationScenarios}**`,
  `- Nichos cobertos: **${report.metadata.stratification.niches}**`,
  `- Oportunidades cobertas: **${report.metadata.stratification.opportunities}**`,
  '- Efeitos externos: **zero**',
  '',
  '## Primeiro contato frio',
  '',
  `- Canal recomendado: **${cold.guardedPatterns.channel}**`,
  `- Abertura: **${cold.guardedPatterns.opening}**`,
  `- Tom: **${cold.guardedPatterns.tone}**`,
  `- CTA: **${cold.guardedPatterns.cta}**`,
  `- Elegíveis: **${cold.summary.eligible}**`,
  `- Bloqueados: **${cold.summary.blocked}**`,
  `- Nichos com recomendações: **${Object.values(cold.topByNiche).filter((items) => items.length > 0).length}**`,
  `- Oportunidades com recomendações: **${Object.values(cold.topByOpportunity).filter((items) => items.length > 0).length}**`,
  '',
  '## Comunicação pós-opt-in',
  '',
  `- Canal permitido: **${postOptIn.guardedPatterns.channel}**`,
  `- Abertura: **${postOptIn.guardedPatterns.opening}**`,
  `- Tom: **${postOptIn.guardedPatterns.tone}**`,
  `- CTA: **${postOptIn.guardedPatterns.cta}**`,
  `- Elegíveis: **${postOptIn.summary.eligible}**`,
  `- Bloqueados: **${postOptIn.summary.blocked}**`,
  '',
  '## Leitura correta',
  '',
  ...report.interpretation.map((item) => `- ${item}`),
  '',
].join('\n');

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(`${outputDirectory}/guarded-communication-recommendations.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(`${outputDirectory}/guarded-communication-recommendations.md`, markdown, 'utf8'),
]);

console.log(JSON.stringify({
  outputDirectory,
  evaluatedRecommendationScenarios: report.metadata.evaluatedRecommendationScenarios,
  coldAcquisition: cold.guardedPatterns,
  postOptIn: postOptIn.guardedPatterns,
  coldNicheCoverage: Object.values(cold.topByNiche).filter((items) => items.length > 0).length,
  coldOpportunityCoverage: Object.values(cold.topByOpportunity).filter((items) => items.length > 0).length,
}, null, 2));