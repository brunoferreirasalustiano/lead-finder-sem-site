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

const summary = summarizeCommunicationExperiment(evaluations);

function topForChannel(channel: CommunicationChannel, limit = 10) {
  return evaluations
    .filter((evaluation) => evaluation.eligible && evaluation.variant.channel === channel)
    .sort((left, right) => right.score - left.score || left.variant.id.localeCompare(right.variant.id))
    .slice(0, limit)
    .map((evaluation) => ({
      id: evaluation.variant.id,
      score: evaluation.score,
      niche: evaluation.variant.niche,
      opportunity: evaluation.variant.opportunity,
      opening: evaluation.variant.opening,
      tone: evaluation.variant.tone,
      cta: evaluation.variant.cta,
      personalization: evaluation.variant.personalization,
      optOut: evaluation.variant.optOut,
      linkPolicy: evaluation.variant.linkPolicy,
      sourceType: evaluation.variant.sourceType,
      diagnosticEvidenceRequired: communicationRequiresDiagnosticEvidence(evaluation.variant),
    }));
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

const topByChannel = Object.fromEntries(
  communicationChannels.map((channel) => [channel, topForChannel(channel)]),
);

const allTop = Object.values(topByChannel).flat();
const guardedPatterns = {
  opening: summary.byOpening[0]?.key ?? null,
  tone: summary.byTone[0]?.key ?? null,
  cta: summary.byCta[0]?.key ?? null,
  channel: summary.byChannel[0]?.key ?? null,
  requiresVerifiedDiagnosticEvidence:
    summary.byOpening[0]?.key === 'DIAGNOSIS_FIRST' ||
    allTop.some((item) => item.personalization === 'DIAGNOSIS'),
};

const report = {
  metadata: {
    schemaVersion: 'v1',
    commit: process.env.GITHUB_HEAD_SHA ?? process.env.GITHUB_SHA ?? 'local',
    simulatedOnly: true,
    realConversionEvidence: false,
    externalEffects: { providers: false, messages: false, webhooks: false, writes: false },
    evaluatedRecommendationScenarios: evaluations.length,
  },
  summary,
  blockedReasons: countValues(evaluations, 'codes'),
  warnings: countValues(evaluations, 'warnings'),
  topByChannel,
  guardedPatterns,
  interpretation: [
    'O ranking contém somente variantes aprovadas pelos guards de canal, fonte, autorização e evidência.',
    'DIAGNOSIS_FIRST e personalização DIAGNOSIS são recomendações condicionais a evidência VERIFIED.',
    'Scores sintéticos não representam taxa real de resposta ou conversão.',
    'Nenhuma variante autoriza envio automático ou WhatsApp sem opt-in.',
  ],
};

const markdown = [
  '# Recomendações sintéticas guardadas',
  '',
  `- Cenários avaliados: **${report.metadata.evaluatedRecommendationScenarios}**`,
  `- Elegíveis após todos os guards: **${summary.eligible}**`,
  `- Bloqueados após todos os guards: **${summary.blocked}**`,
  `- Média heurística dos elegíveis: **${summary.averageEligibleScore}**`,
  '- Efeitos externos: **zero**',
  '',
  '## Padrões condicionais',
  '',
  `- Abertura: **${guardedPatterns.opening}**`,
  `- Tom: **${guardedPatterns.tone}**`,
  `- CTA: **${guardedPatterns.cta}**`,
  `- Canal: **${guardedPatterns.channel}**`,
  `- Evidência diagnóstica verificada exigida: **${guardedPatterns.requiresVerifiedDiagnosticEvidence ? 'SIM' : 'NÃO'}**`,
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
  eligible: summary.eligible,
  blocked: summary.blocked,
  guardedPatterns,
}, null, 2));
