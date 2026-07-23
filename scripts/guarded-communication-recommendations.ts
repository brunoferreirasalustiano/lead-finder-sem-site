import { mkdir, writeFile } from 'node:fs/promises';
import {
  communicationChannels,
  generateExtendedCommunicationCases,
  summarizeCommunicationExperiment,
  type CommunicationChannel,
  type CommunicationEvaluation,
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

function topForChannel(items: readonly CommunicationEvaluation[], channel: CommunicationChannel, limit = 10) {
  return items
    .filter((evaluation) => evaluation.eligible && evaluation.variant.channel === channel)
    .sort((left, right) => right.score - left.score || left.variant.id.localeCompare(right.variant.id))
    .slice(0, limit)
    .map(serializeEvaluation);
}

function topForStage(items: readonly CommunicationEvaluation[], limit = 20) {
  return items
    .filter((evaluation) => evaluation.eligible)
    .sort((left, right) => right.score - left.score || left.variant.id.localeCompare(right.variant.id))
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
  const topVariants = topForStage(items);
  return {
    stage,
    summary,
    blockedReasons: countValues(items, 'codes'),
    warnings: countValues(items, 'warnings'),
    topByChannel,
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
    schemaVersion: 'v2',
    commit: process.env.GITHUB_HEAD_SHA ?? process.env.GITHUB_SHA ?? 'local',
    simulatedOnly: true,
    realConversionEvidence: false,
    externalEffects: { providers: false, messages: false, webhooks: false, writes: false },
    evaluatedRecommendationScenarios: evaluations.length,
  },
  stages,
  interpretation: [
    'COLD_ACQUISITION contém somente e-mail, formulário empresarial e DM empresarial.',
    'POST_OPT_IN contém somente WhatsApp com autorização válida já registrada.',
    'ALL_GUARDED é uma visão técnica consolidada e não deve ser usada para escolher o primeiro canal.',
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
}, null, 2));
