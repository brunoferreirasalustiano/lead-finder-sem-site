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
const recommendationsPerGroup = 3;
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

type SerializedEvaluation = ReturnType<typeof serializeEvaluation>;
type ExperimentSummary = ReturnType<typeof summarizeCommunicationExperiment>;
type IntersectionSummary = Pick<
  ExperimentSummary,
  'total' | 'eligible' | 'blocked' | 'averageEligibleScore'
>;

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

function topForNiche(items: readonly CommunicationEvaluation[], niche: CommunicationNiche, limit = recommendationsPerGroup) {
  return rankEligible(items)
    .filter((evaluation) => evaluation.variant.niche === niche)
    .slice(0, limit)
    .map(serializeEvaluation);
}

function topForOpportunity(
  items: readonly CommunicationEvaluation[],
  opportunity: OpportunityState,
  limit = recommendationsPerGroup,
) {
  return rankEligible(items)
    .filter((evaluation) => evaluation.variant.opportunity === opportunity)
    .slice(0, limit)
    .map(serializeEvaluation);
}

function itemsForNicheOpportunity(
  items: readonly CommunicationEvaluation[],
  niche: CommunicationNiche,
  opportunity: OpportunityState,
) {
  return items.filter(
    (evaluation) => evaluation.variant.niche === niche && evaluation.variant.opportunity === opportunity,
  );
}

function topForNicheOpportunity(
  items: readonly CommunicationEvaluation[],
  niche: CommunicationNiche,
  opportunity: OpportunityState,
  limit = recommendationsPerGroup,
) {
  return rankEligible(itemsForNicheOpportunity(items, niche, opportunity))
    .slice(0, limit)
    .map(serializeEvaluation);
}

function createCrossStratification(items: readonly CommunicationEvaluation[]) {
  return Object.fromEntries(
    communicationNiches.map((niche) => [
      niche,
      Object.fromEntries(
        opportunityStates.map((opportunity) => [
          opportunity,
          topForNicheOpportunity(items, niche, opportunity),
        ]),
      ) as Record<OpportunityState, SerializedEvaluation[]>,
    ]),
  ) as Record<CommunicationNiche, Record<OpportunityState, SerializedEvaluation[]>>;
}

function createCrossSummaries(items: readonly CommunicationEvaluation[]) {
  return Object.fromEntries(
    communicationNiches.map((niche) => [
      niche,
      Object.fromEntries(
        opportunityStates.map((opportunity) => {
          const summary = summarizeCommunicationExperiment(
            itemsForNicheOpportunity(items, niche, opportunity),
          );
          return [
            opportunity,
            {
              total: summary.total,
              eligible: summary.eligible,
              blocked: summary.blocked,
              averageEligibleScore: summary.averageEligibleScore,
            } satisfies IntersectionSummary,
          ];
        }),
      ) as Record<OpportunityState, IntersectionSummary>,
    ]),
  ) as Record<CommunicationNiche, Record<OpportunityState, IntersectionSummary>>;
}

function validateCrossStratification(
  stage: RecommendationStage,
  cross: Record<CommunicationNiche, Record<OpportunityState, SerializedEvaluation[]>>,
) {
  for (const niche of communicationNiches) {
    for (const opportunity of opportunityStates) {
      const recommendations = cross[niche][opportunity];
      if (recommendations.length !== recommendationsPerGroup) {
        throw new Error(`CROSS_RECOMMENDATIONS_MISSING:${stage}:${niche}:${opportunity}`);
      }
      if (new Set(recommendations.map(({ id }) => id)).size !== recommendations.length) {
        throw new Error(`CROSS_RECOMMENDATION_DUPLICATE:${stage}:${niche}:${opportunity}`);
      }
      if (
        recommendations.some(
          (recommendation) =>
            recommendation.niche !== niche || recommendation.opportunity !== opportunity,
        )
      ) {
        throw new Error(`CROSS_RECOMMENDATION_MISMATCH:${stage}:${niche}:${opportunity}`);
      }
    }
  }
}

function validateCrossSummaries(
  stage: RecommendationStage,
  cross: Record<CommunicationNiche, Record<OpportunityState, IntersectionSummary>>,
  stageSummary: ExperimentSummary,
) {
  let globalTotal = 0;
  let globalEligible = 0;
  let globalBlocked = 0;

  for (const niche of communicationNiches) {
    let nicheTotal = 0;
    let nicheEligible = 0;
    let nicheBlocked = 0;
    for (const opportunity of opportunityStates) {
      const summary = cross[niche][opportunity];
      if (summary.total !== summary.eligible + summary.blocked || summary.total <= 0) {
        throw new Error(`CROSS_SUMMARY_INVALID:${stage}:${niche}:${opportunity}`);
      }
      if (!Number.isFinite(summary.averageEligibleScore)) {
        throw new Error(`CROSS_SUMMARY_SCORE_INVALID:${stage}:${niche}:${opportunity}`);
      }
      nicheTotal += summary.total;
      nicheEligible += summary.eligible;
      nicheBlocked += summary.blocked;
    }
    const expected = stageSummary.byNiche.find(({ key }) => key === niche);
    if (!expected || expected.eligible !== nicheEligible || expected.blocked !== nicheBlocked) {
      throw new Error(`CROSS_SUMMARY_NICHE_RECONCILIATION_FAILED:${stage}:${niche}`);
    }
    if (nicheTotal !== nicheEligible + nicheBlocked) {
      throw new Error(`CROSS_SUMMARY_NICHE_TOTAL_INVALID:${stage}:${niche}`);
    }
    globalTotal += nicheTotal;
    globalEligible += nicheEligible;
    globalBlocked += nicheBlocked;
  }

  for (const opportunity of opportunityStates) {
    const opportunitySummary = communicationNiches.reduce(
      (accumulator, niche) => {
        const summary = cross[niche][opportunity];
        accumulator.total += summary.total;
        accumulator.eligible += summary.eligible;
        accumulator.blocked += summary.blocked;
        return accumulator;
      },
      { total: 0, eligible: 0, blocked: 0 },
    );
    const expected = stageSummary.byOpportunity.find(({ key }) => key === opportunity);
    if (
      !expected ||
      expected.eligible !== opportunitySummary.eligible ||
      expected.blocked !== opportunitySummary.blocked ||
      opportunitySummary.total !== opportunitySummary.eligible + opportunitySummary.blocked
    ) {
      throw new Error(`CROSS_SUMMARY_OPPORTUNITY_RECONCILIATION_FAILED:${stage}:${opportunity}`);
    }
  }

  if (
    globalTotal !== stageSummary.total ||
    globalEligible !== stageSummary.eligible ||
    globalBlocked !== stageSummary.blocked
  ) {
    throw new Error(`CROSS_SUMMARY_STAGE_RECONCILIATION_FAILED:${stage}`);
  }
}

function countCrossIntersections(
  cross: Record<CommunicationNiche, Record<OpportunityState, readonly unknown[]>>,
) {
  let count = 0;
  for (const niche of communicationNiches) {
    for (const opportunity of opportunityStates) {
      if (cross[niche][opportunity].length > 0) count += 1;
    }
  }
  return count;
}

function countCrossSummaries(
  cross: Record<CommunicationNiche, Record<OpportunityState, IntersectionSummary>>,
) {
  return communicationNiches.reduce(
    (count, niche) =>
      count + opportunityStates.filter((opportunity) => cross[niche][opportunity].total > 0).length,
    0,
  );
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
  const allowedChannels =
    stage === 'COLD_ACQUISITION'
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
  const topByNicheOpportunity = createCrossStratification(items);
  const summaryByNicheOpportunity = createCrossSummaries(items);
  validateCrossStratification(stage, topByNicheOpportunity);
  validateCrossSummaries(stage, summaryByNicheOpportunity, summary);
  const topVariants = topForStage(items);
  return {
    stage,
    summary,
    blockedReasons: countValues(items, 'codes'),
    warnings: countValues(items, 'warnings'),
    topByChannel,
    topByNiche,
    topByOpportunity,
    topByNicheOpportunity,
    summaryByNicheOpportunity,
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
      intersections: communicationNiches.length * opportunityStates.length,
      intersectionSummaries: communicationNiches.length * opportunityStates.length,
      recommendationsPerGroup,
      recommendationsPerIntersection: recommendationsPerGroup,
    },
  },
  stages,
  interpretation: [
    'COLD_ACQUISITION contém somente e-mail, formulário empresarial e DM empresarial.',
    'POST_OPT_IN contém somente WhatsApp com autorização válida já registrada.',
    'ALL_GUARDED é uma visão técnica consolidada e não deve ser usada para escolher o primeiro canal.',
    'topByNiche, topByOpportunity e topByNicheOpportunity evitam que empates escondam grupos ou interseções.',
    'summaryByNicheOpportunity informa total, elegíveis, bloqueados e média de cada interseção.',
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
  `- Interseções nicho × oportunidade: **${report.metadata.stratification.intersections}**`,
  `- Resumos estatísticos por interseção: **${report.metadata.stratification.intersectionSummaries}**`,
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
  `- Interseções com recomendações: **${countCrossIntersections(cold.topByNicheOpportunity)}**`,
  `- Interseções com resumo: **${countCrossSummaries(cold.summaryByNicheOpportunity)}**`,
  '',
  '## Comunicação pós-opt-in',
  '',
  `- Canal permitido: **${postOptIn.guardedPatterns.channel}**`,
  `- Abertura: **${postOptIn.guardedPatterns.opening}**`,
  `- Tom: **${postOptIn.guardedPatterns.tone}**`,
  `- CTA: **${postOptIn.guardedPatterns.cta}**`,
  `- Elegíveis: **${postOptIn.summary.eligible}**`,
  `- Bloqueados: **${postOptIn.summary.blocked}**`,
  `- Interseções com recomendações: **${countCrossIntersections(postOptIn.topByNicheOpportunity)}**`,
  `- Interseções com resumo: **${countCrossSummaries(postOptIn.summaryByNicheOpportunity)}**`,
  '',
  '## Leitura correta',
  '',
  ...report.interpretation.map((item) => `- ${item}`),
  '',
].join('\n');

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    `${outputDirectory}/guarded-communication-recommendations.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  ),
  writeFile(`${outputDirectory}/guarded-communication-recommendations.md`, markdown, 'utf8'),
]);

console.log(
  JSON.stringify(
    {
      outputDirectory,
      evaluatedRecommendationScenarios: report.metadata.evaluatedRecommendationScenarios,
      coldAcquisition: cold.guardedPatterns,
      postOptIn: postOptIn.guardedPatterns,
      coldNicheCoverage: Object.values(cold.topByNiche).filter((items) => items.length > 0).length,
      coldOpportunityCoverage: Object.values(cold.topByOpportunity).filter((items) => items.length > 0).length,
      coldCrossIntersectionCoverage: countCrossIntersections(cold.topByNicheOpportunity),
      coldCrossSummaryCoverage: countCrossSummaries(cold.summaryByNicheOpportunity),
    },
    null,
    2,
  ),
);
