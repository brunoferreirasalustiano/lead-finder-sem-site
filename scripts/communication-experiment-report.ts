import { mkdir, writeFile } from 'node:fs/promises';
import {
  communicationChannels,
  communicationSolutions,
  evaluateCommunicationVariant,
  generateCoreCommunicationCases,
  generateExtendedCommunicationCases,
  summarizeCommunicationExperiment,
  type CommunicationChannel,
  type CommunicationEvaluation,
} from '../packages/messaging/src/communication-lab.js';

const outputDirectory = process.env.COMMUNICATION_LAB_OUTPUT_DIR ?? 'artifacts/communication-lab';
const evaluations = generateExtendedCommunicationCases().map(evaluateCommunicationVariant);
const summary = summarizeCommunicationExperiment(evaluations);

function topForChannel(channel: CommunicationChannel, limit = 5) {
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
    }));
}

function countCodes(items: readonly CommunicationEvaluation[]) {
  const counts = new Map<string, number>();
  for (const evaluation of items) {
    for (const code of evaluation.codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

const report = {
  metadata: {
    schemaVersion: 'v1',
    commit: process.env.GITHUB_SHA ?? 'local',
    simulatedOnly: true,
    realConversionEvidence: false,
    externalEffects: {
      providers: false,
      messages: false,
      webhooks: false,
      writes: false,
    },
    namedCoreTests: generateCoreCommunicationCases().length,
    evaluatedScenarios: evaluations.length,
  },
  solutions: communicationSolutions,
  summary,
  blockedReasons: countCodes(evaluations),
  topByChannel: Object.fromEntries(
    communicationChannels.map((channel) => [channel, topForChannel(channel)]),
  ),
  provisionalPatterns: {
    opening: summary.byOpening[0]?.key ?? null,
    tone: summary.byTone[0]?.key ?? null,
    cta: summary.byCta[0]?.key ?? null,
    postOptInChannel: summary.byChannel[0]?.key ?? null,
    interpretation: [
      'Os resultados são heurísticos e não representam taxa real de resposta ou conversão.',
      'WhatsApp só aparece no ranking após autorização explícita já registrada.',
      'O primeiro piloto real deve comparar poucas variantes e registrar resposta, opt-out e qualidade da conversa.',
    ],
  },
};

const markdown = [
  '# Relatório sintético — laboratório de comunicação',
  '',
  `- Cenários avaliados: **${report.metadata.evaluatedScenarios}**`,
  `- Testes centrais nomeados: **${report.metadata.namedCoreTests}**`,
  `- Cenários elegíveis: **${summary.eligible}**`,
  `- Cenários bloqueados: **${summary.blocked}**`,
  `- Média heurística dos elegíveis: **${summary.averageEligibleScore}**`,
  '- Efeitos externos: **zero**',
  '',
  '## Padrões provisórios',
  '',
  `- Abertura: **${report.provisionalPatterns.opening}**`,
  `- Tom: **${report.provisionalPatterns.tone}**`,
  `- CTA: **${report.provisionalPatterns.cta}**`,
  `- Melhor canal pós-opt-in: **${report.provisionalPatterns.postOptInChannel}**`,
  '',
  '## Leitura correta',
  '',
  ...report.provisionalPatterns.interpretation.map((item) => `- ${item}`),
  '',
  '## Bloqueios mais frequentes',
  '',
  ...report.blockedReasons.slice(0, 10).map((item) => `- ${item.code}: ${item.count}`),
  '',
  '## Próximo experimento real mínimo',
  '',
  '1. selecionar um único nicho e uma única região;',
  '2. usar no máximo duas variantes de primeiro contato;',
  '3. manter no máximo cinco contatos manuais por onda;',
  '4. medir resposta, permissão para demonstração, opt-out e qualidade da conversa;',
  '5. não promover nenhuma variante por score sintético isolado.',
  '',
].join('\n');

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(`${outputDirectory}/communication-experiment-report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(`${outputDirectory}/communication-experiment-report.md`, markdown, 'utf8'),
]);

console.log(JSON.stringify({
  outputDirectory,
  namedCoreTests: report.metadata.namedCoreTests,
  evaluatedScenarios: report.metadata.evaluatedScenarios,
  eligible: summary.eligible,
  blocked: summary.blocked,
  provisionalPatterns: report.provisionalPatterns,
}, null, 2));
