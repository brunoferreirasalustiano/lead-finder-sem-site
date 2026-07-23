export const communicationNiches = [
  'BEAUTY',
  'AUTOMOTIVE',
  'FOOD',
  'HOME_SERVICES',
  'LOCAL_RETAIL',
  'PET',
  'FITNESS_EDUCATION',
  'CREATIVE_EVENTS',
  'LOCAL_B2B',
] as const;

export const opportunityStates = [
  'NO_SITE',
  'THIRD_PARTY_ONLY',
  'WEAK_SITE',
  'BROKEN_SITE',
  'WEAK_CONVERSION',
] as const;

export const communicationChannels = [
  'EMAIL',
  'CONTACT_FORM',
  'BUSINESS_DM',
  'WHATSAPP_OPT_IN',
] as const;

export const openingStyles = [
  'PERMISSION_FIRST',
  'DIAGNOSIS_FIRST',
  'BENEFIT_FIRST',
  'CREDIBILITY_FIRST',
] as const;

export const communicationTones = ['DIRECT', 'CONSULTATIVE', 'FRIENDLY'] as const;
export const callToActions = ['ASK_PERMISSION', 'ASK_BEST_CHANNEL', 'ASK_INTEREST'] as const;
export const personalizationLevels = ['BASIC', 'SEGMENT', 'DIAGNOSIS'] as const;
export const optOutStyles = ['EXPLICIT', 'SHORT', 'MISSING'] as const;
export const linkPolicies = ['NONE', 'OWN_DOMAIN', 'THIRD_PARTY'] as const;
export const authorizationStates = [
  'NOT_REQUIRED',
  'NONE',
  'PUBLIC_NUMBER',
  'DIRECT_OPT_IN',
  'FORM_OPT_IN',
  'SIGNED_RECORD',
] as const;
export const sourceTypes = [
  'OFFICIAL_WEBSITE',
  'OFFICIAL_CONTACT_FORM',
  'OFFICIAL_BUSINESS_PROFILE',
  'PUBLIC_BUSINESS_DIRECTORY',
  'DIRECTLY_PROVIDED',
  'PURCHASED_LIST',
  'LEAKED_DATA',
] as const;

export type CommunicationNiche = (typeof communicationNiches)[number];
export type OpportunityState = (typeof opportunityStates)[number];
export type CommunicationChannel = (typeof communicationChannels)[number];
export type OpeningStyle = (typeof openingStyles)[number];
export type CommunicationTone = (typeof communicationTones)[number];
export type CallToAction = (typeof callToActions)[number];
export type PersonalizationLevel = (typeof personalizationLevels)[number];
export type OptOutStyle = (typeof optOutStyles)[number];
export type LinkPolicy = (typeof linkPolicies)[number];
export type AuthorizationState = (typeof authorizationStates)[number];
export type SourceType = (typeof sourceTypes)[number];

export interface CommunicationVariant {
  id: string;
  niche: CommunicationNiche;
  opportunity: OpportunityState;
  channel: CommunicationChannel;
  opening: OpeningStyle;
  tone: CommunicationTone;
  cta: CallToAction;
  personalization: PersonalizationLevel;
  optOut: OptOutStyle;
  linkPolicy: LinkPolicy;
  authorization: AuthorizationState;
  sourceType: SourceType;
}

export interface RenderedCommunication {
  subject?: string;
  body: string;
}

export interface CommunicationEvaluation {
  variant: CommunicationVariant;
  eligible: boolean;
  score: number;
  codes: string[];
  warnings: string[];
  rendered: RenderedCommunication;
}

export interface CommunicationSolution {
  id: string;
  channel: CommunicationChannel | 'INBOUND';
  name: string;
  hypothesis: string;
  requiresOptIn: boolean;
  risk: 'LOW' | 'MEDIUM';
}

export const communicationSolutions: readonly CommunicationSolution[] = [
  {
    id: 'EMAIL_PERMISSION_FIRST',
    channel: 'EMAIL',
    name: 'E-mail permission-first',
    hypothesis: 'Reduz pressão e obtém autorização antes de enviar a demonstração.',
    requiresOptIn: false,
    risk: 'LOW',
  },
  {
    id: 'EMAIL_DIAGNOSIS_FIRST',
    channel: 'EMAIL',
    name: 'E-mail diagnosis-first',
    hypothesis: 'Uma observação objetiva aumenta pertinência quando há problema verificável.',
    requiresOptIn: false,
    risk: 'LOW',
  },
  {
    id: 'EMAIL_BENEFIT_FIRST',
    channel: 'EMAIL',
    name: 'E-mail benefit-first',
    hypothesis: 'Comunica valor rapidamente para operações locais com baixa disponibilidade.',
    requiresOptIn: false,
    risk: 'LOW',
  },
  {
    id: 'EMAIL_CREDIBILITY_LINK',
    channel: 'EMAIL',
    name: 'E-mail com credibilidade e um link próprio',
    hypothesis: 'Um único link institucional pode elevar confiança sem sobrecarregar a mensagem.',
    requiresOptIn: false,
    risk: 'MEDIUM',
  },
  {
    id: 'CONTACT_FORM_SHORT',
    channel: 'CONTACT_FORM',
    name: 'Formulário empresarial curto',
    hypothesis: 'Usa o canal que o próprio negócio disponibilizou para contatos profissionais.',
    requiresOptIn: false,
    risk: 'LOW',
  },
  {
    id: 'BUSINESS_DM_BEST_CHANNEL',
    channel: 'BUSINESS_DM',
    name: 'DM pedindo o melhor canal',
    hypothesis: 'Uma pergunta curta reduz fricção e transfere a escolha do canal ao negócio.',
    requiresOptIn: false,
    risk: 'MEDIUM',
  },
  {
    id: 'LANDING_QR_INBOUND',
    channel: 'INBOUND',
    name: 'Landing page ou QR Code para opt-in',
    hypothesis: 'O próprio negócio inicia a conversa após compreender a proposta.',
    requiresOptIn: false,
    risk: 'LOW',
  },
  {
    id: 'REFERRAL_PARTNERSHIP',
    channel: 'INBOUND',
    name: 'Indicação ou parceria',
    hypothesis: 'Confiança transferida reduz a percepção de contato frio.',
    requiresOptIn: false,
    risk: 'LOW',
  },
  {
    id: 'CLICK_TO_WHATSAPP',
    channel: 'INBOUND',
    name: 'Anúncio click-to-WhatsApp',
    hypothesis: 'A conversa começa por ação voluntária do potencial cliente.',
    requiresOptIn: false,
    risk: 'LOW',
  },
  {
    id: 'WHATSAPP_AFTER_OPT_IN',
    channel: 'WHATSAPP_OPT_IN',
    name: 'WhatsApp após opt-in',
    hypothesis: 'Combina alta resposta com autorização explícita e contexto registrado.',
    requiresOptIn: true,
    risk: 'LOW',
  },
] as const;

const forbiddenClaimPattern = /\b(garantimos|resultado garantido|dobrar vendas|vendas certas|sem risco|imperd[ií]vel|[uú]ltima chance)\b/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}\b/;
const approvedWhatsAppAuthorization = new Set<AuthorizationState>([
  'DIRECT_OPT_IN',
  'FORM_OPT_IN',
  'SIGNED_RECORD',
]);

const opportunityText: Record<OpportunityState, string> = {
  NO_SITE: 'a ausência de uma página própria para apresentar serviços e facilitar novos contatos',
  THIRD_PARTY_ONLY: 'a dependência de plataformas de terceiros para apresentar o negócio',
  WEAK_SITE: 'alguns pontos da presença digital que podem ficar mais claros e funcionais',
  BROKEN_SITE: 'uma dificuldade objetiva de navegação ou contato na presença digital atual',
  WEAK_CONVERSION: 'a falta de um caminho claro para orçamento, reserva, catálogo ou contato',
};

const nicheText: Record<CommunicationNiche, string> = {
  BEAUTY: 'beleza e cuidados pessoais',
  AUTOMOTIVE: 'serviços automotivos',
  FOOD: 'alimentação e delivery',
  HOME_SERVICES: 'serviços residenciais e manutenção',
  LOCAL_RETAIL: 'comércio local e catálogo',
  PET: 'serviços para pets',
  FITNESS_EDUCATION: 'academia, estúdio ou educação livre',
  CREATIVE_EVENTS: 'eventos e serviços criativos',
  LOCAL_B2B: 'serviços B2B locais',
};

const openingText: Record<OpeningStyle, (variant: CommunicationVariant) => string> = {
  PERMISSION_FIRST: () =>
    'Posso compartilhar uma ideia breve de presença digital preparada para avaliação, sem compromisso?',
  DIAGNOSIS_FIRST: (variant) =>
    `Observei ${opportunityText[variant.opportunity]}. Preparei uma hipótese simples para melhorar esse ponto.`,
  BENEFIT_FIRST: (variant) =>
    `Uma página objetiva pode facilitar ${variant.opportunity === 'WEAK_CONVERSION' ? 'orçamentos e contatos' : 'a apresentação do negócio e o próximo passo do cliente'}.`,
  CREDIBILITY_FIRST: () =>
    'Trabalho com páginas e soluções digitais para negócios locais, com escopo claro e demonstração antes de qualquer contratação.',
};

const tonePrefix: Record<CommunicationTone, string> = {
  DIRECT: 'Vou ser direto:',
  CONSULTATIVE: 'Analisei a presença digital pública da empresa e identifiquei uma oportunidade:',
  FRIENDLY: 'Tudo bem? Vi o trabalho de vocês e achei que valia compartilhar uma ideia:',
};

const ctaText: Record<CallToAction, string> = {
  ASK_PERMISSION: 'Posso enviar uma demonstração curta para vocês avaliarem?',
  ASK_BEST_CHANNEL: 'Qual é o melhor canal para eu apresentar essa ideia à pessoa responsável?',
  ASK_INTEREST: 'Faz sentido conversar sobre essa melhoria neste momento?',
};

const optOutText: Record<OptOutStyle, string> = {
  EXPLICIT: 'Caso não queira continuar, basta avisar e o contato será encerrado e bloqueado imediatamente.',
  SHORT: 'Se não houver interesse, é só me avisar e encerro o contato.',
  MISSING: '',
};

const sourceText: Record<SourceType, string> = {
  OFFICIAL_WEBSITE: 'no site oficial da empresa',
  OFFICIAL_CONTACT_FORM: 'no formulário oficial da empresa',
  OFFICIAL_BUSINESS_PROFILE: 'no perfil empresarial público',
  PUBLIC_BUSINESS_DIRECTORY: 'em uma fonte pública de negócios',
  DIRECTLY_PROVIDED: 'em um canal fornecido diretamente pela empresa',
  PURCHASED_LIST: 'em uma lista adquirida',
  LEAKED_DATA: 'em dados de origem não autorizada',
};

const messageLimitByChannel: Record<CommunicationChannel, number> = {
  EMAIL: 1_200,
  CONTACT_FORM: 700,
  BUSINESS_DM: 650,
  WHATSAPP_OPT_IN: 900,
};

export function renderCommunicationVariant(variant: CommunicationVariant): RenderedCommunication {
  const greeting = variant.channel === 'WHATSAPP_OPT_IN'
    ? 'Olá, equipe da [EMPRESA]. Obrigado por autorizar nosso contato por WhatsApp.'
    : 'Olá, equipe da [EMPRESA].';
  const identity = 'Sou Bruno F. Salustiano, da Lead Finder Brasil.';
  const source = variant.channel === 'WHATSAPP_OPT_IN'
    ? ''
    : `Encontrei este canal comercial ${sourceText[variant.sourceType]}.`;
  const personalization = variant.personalization === 'DIAGNOSIS'
    ? `O ponto observado foi [DIAGNOSTICO]: ${opportunityText[variant.opportunity]}.`
    : variant.personalization === 'SEGMENT'
      ? `A ideia foi pensada para negócios de ${nicheText[variant.niche]}.`
      : 'A ideia é simples e pode ser avaliada sem compromisso.';
  const link = variant.linkPolicy === 'OWN_DOMAIN'
    ? 'Referência institucional: [LINK_INSTITUCIONAL].'
    : variant.linkPolicy === 'THIRD_PARTY'
      ? 'Confira também: [LINK_TERCEIRO].'
      : '';
  const body = [
    greeting,
    identity,
    source,
    tonePrefix[variant.tone],
    openingText[variant.opening](variant),
    personalization,
    link,
    ctaText[variant.cta],
    optOutText[variant.optOut],
  ].filter(Boolean).join(' ');

  return {
    subject: variant.channel === 'EMAIL'
      ? `${variant.opening === 'DIAGNOSIS_FIRST' ? 'Uma observação' : 'Uma ideia'} para a presença digital da [EMPRESA]`
      : undefined,
    body,
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function evaluateCommunicationVariant(variant: CommunicationVariant): CommunicationEvaluation {
  const rendered = renderCommunicationVariant(variant);
  const codes: string[] = [];
  const warnings: string[] = [];

  if (variant.sourceType === 'PURCHASED_LIST' || variant.sourceType === 'LEAKED_DATA') {
    codes.push('SOURCE_REJECTED');
  }
  if (variant.channel === 'WHATSAPP_OPT_IN' && !approvedWhatsAppAuthorization.has(variant.authorization)) {
    codes.push('WHATSAPP_OPT_IN_REQUIRED');
  }
  if (variant.channel !== 'WHATSAPP_OPT_IN' && variant.authorization !== 'NOT_REQUIRED') {
    warnings.push('UNNECESSARY_AUTHORIZATION_STATE');
  }
  if (variant.optOut === 'MISSING') codes.push('OPT_OUT_REQUIRED');
  if (variant.linkPolicy === 'THIRD_PARTY') codes.push('THIRD_PARTY_LINK_BLOCKED');
  if (forbiddenClaimPattern.test(rendered.body)) codes.push('DECEPTIVE_CLAIM');
  if (rendered.body.length > messageLimitByChannel[variant.channel]) codes.push('MESSAGE_TOO_LONG');
  if (emailPattern.test(rendered.body) || phonePattern.test(rendered.body)) codes.push('PII_DETECTED');
  if (/\b(sent|delivered|enviado automaticamente|disparo em massa)\b/i.test(rendered.body)) {
    codes.push('DELIVERY_CLAIM_BLOCKED');
  }

  let score = 10;
  score += {
    NO_SITE: 8,
    THIRD_PARTY_ONLY: 7,
    WEAK_SITE: 9,
    BROKEN_SITE: 12,
    WEAK_CONVERSION: 11,
  }[variant.opportunity];
  score += {
    EMAIL: 8,
    CONTACT_FORM: 7,
    BUSINESS_DM: 6,
    WHATSAPP_OPT_IN: 10,
  }[variant.channel];
  score += {
    PERMISSION_FIRST: 9,
    DIAGNOSIS_FIRST: ['WEAK_SITE', 'BROKEN_SITE', 'WEAK_CONVERSION'].includes(variant.opportunity) ? 12 : 6,
    BENEFIT_FIRST: 6,
    CREDIBILITY_FIRST: 5,
  }[variant.opening];
  score += { DIRECT: 4, CONSULTATIVE: 8, FRIENDLY: 6 }[variant.tone];
  score += { ASK_PERMISSION: 10, ASK_BEST_CHANNEL: 8, ASK_INTEREST: 6 }[variant.cta];
  score += { BASIC: 3, SEGMENT: 8, DIAGNOSIS: 12 }[variant.personalization];
  score += { EXPLICIT: 5, SHORT: 3, MISSING: -20 }[variant.optOut];
  score += { NONE: 3, OWN_DOMAIN: 1, THIRD_PARTY: -20 }[variant.linkPolicy];

  if (variant.channel === 'WHATSAPP_OPT_IN' && approvedWhatsAppAuthorization.has(variant.authorization)) score += 3;
  if (variant.sourceType === 'OFFICIAL_WEBSITE' || variant.sourceType === 'DIRECTLY_PROVIDED') score += 3;
  if (variant.sourceType === 'PUBLIC_BUSINESS_DIRECTORY') warnings.push('DIRECTORY_SOURCE_REQUIRES_REVIEW');
  if (variant.personalization === 'DIAGNOSIS' && variant.opening === 'DIAGNOSIS_FIRST') score += 3;
  if (variant.linkPolicy === 'OWN_DOMAIN' && variant.opening !== 'CREDIBILITY_FIRST') warnings.push('LINK_MAY_ADD_FRICTION');

  const eligible = codes.length === 0;
  return {
    variant,
    eligible,
    score: eligible ? clampScore(score) : 0,
    codes: [...new Set(codes)].sort(),
    warnings: [...new Set(warnings)].sort(),
    rendered,
  };
}

function authorizationForChannel(channel: CommunicationChannel): AuthorizationState {
  return channel === 'WHATSAPP_OPT_IN' ? 'DIRECT_OPT_IN' : 'NOT_REQUIRED';
}

function sourceForChannel(channel: CommunicationChannel): SourceType {
  if (channel === 'CONTACT_FORM') return 'OFFICIAL_CONTACT_FORM';
  if (channel === 'BUSINESS_DM') return 'OFFICIAL_BUSINESS_PROFILE';
  if (channel === 'WHATSAPP_OPT_IN') return 'DIRECTLY_PROVIDED';
  return 'OFFICIAL_WEBSITE';
}

export function generateCoreCommunicationCases(): CommunicationVariant[] {
  const cases: CommunicationVariant[] = [];
  let index = 0;
  for (const niche of communicationNiches) {
    for (const opportunity of opportunityStates) {
      for (const opening of openingStyles) {
        for (const tone of communicationTones) {
          for (const cta of callToActions.slice(0, 2)) {
            const channel = communicationChannels[index % communicationChannels.length] ?? 'EMAIL';
            const personalization: PersonalizationLevel = ['WEAK_SITE', 'BROKEN_SITE', 'WEAK_CONVERSION'].includes(opportunity)
              ? 'DIAGNOSIS'
              : 'SEGMENT';
            cases.push({
              id: `core-${String(index + 1).padStart(4, '0')}`,
              niche,
              opportunity,
              channel,
              opening,
              tone,
              cta,
              personalization,
              optOut: 'EXPLICIT',
              linkPolicy: opening === 'CREDIBILITY_FIRST' && channel === 'EMAIL' ? 'OWN_DOMAIN' : 'NONE',
              authorization: authorizationForChannel(channel),
              sourceType: sourceForChannel(channel),
            });
            index += 1;
          }
        }
      }
    }
  }
  return cases;
}

export function generateExtendedCommunicationCases(): CommunicationVariant[] {
  const cases: CommunicationVariant[] = [];
  let index = 0;
  for (const niche of communicationNiches) {
    for (const opportunity of opportunityStates) {
      for (const opening of openingStyles) {
        for (const tone of communicationTones) {
          for (const cta of callToActions) {
            for (const personalization of personalizationLevels) {
              for (const optOut of optOutStyles) {
                const channel = communicationChannels[index % communicationChannels.length] ?? 'EMAIL';
                const linkPolicy = linkPolicies[index % linkPolicies.length] ?? 'NONE';
                cases.push({
                  id: `extended-${String(index + 1).padStart(5, '0')}`,
                  niche,
                  opportunity,
                  channel,
                  opening,
                  tone,
                  cta,
                  personalization,
                  optOut,
                  linkPolicy,
                  authorization: authorizationForChannel(channel),
                  sourceType: sourceForChannel(channel),
                });
                index += 1;
              }
            }
          }
        }
      }
    }
  }
  return cases;
}

interface GroupSummary {
  key: string;
  eligible: number;
  blocked: number;
  averageScore: number;
}

function groupEvaluations(
  evaluations: readonly CommunicationEvaluation[],
  selector: (evaluation: CommunicationEvaluation) => string,
): GroupSummary[] {
  const groups = new Map<string, { eligible: number; blocked: number; score: number }>();
  for (const evaluation of evaluations) {
    const key = selector(evaluation);
    const current = groups.get(key) ?? { eligible: 0, blocked: 0, score: 0 };
    if (evaluation.eligible) {
      current.eligible += 1;
      current.score += evaluation.score;
    } else {
      current.blocked += 1;
    }
    groups.set(key, current);
  }
  return [...groups.entries()]
    .map(([key, value]) => ({
      key,
      eligible: value.eligible,
      blocked: value.blocked,
      averageScore: value.eligible === 0 ? 0 : Math.round((value.score / value.eligible) * 100) / 100,
    }))
    .sort((left, right) => right.averageScore - left.averageScore || left.key.localeCompare(right.key));
}

export function summarizeCommunicationExperiment(evaluations: readonly CommunicationEvaluation[]) {
  const eligible = evaluations.filter((evaluation) => evaluation.eligible);
  const blocked = evaluations.length - eligible.length;
  return {
    total: evaluations.length,
    eligible: eligible.length,
    blocked,
    averageEligibleScore: eligible.length === 0
      ? 0
      : Math.round((eligible.reduce((sum, evaluation) => sum + evaluation.score, 0) / eligible.length) * 100) / 100,
    byChannel: groupEvaluations(evaluations, (evaluation) => evaluation.variant.channel),
    byOpening: groupEvaluations(evaluations, (evaluation) => evaluation.variant.opening),
    byTone: groupEvaluations(evaluations, (evaluation) => evaluation.variant.tone),
    byCta: groupEvaluations(evaluations, (evaluation) => evaluation.variant.cta),
    byNiche: groupEvaluations(evaluations, (evaluation) => evaluation.variant.niche),
    byOpportunity: groupEvaluations(evaluations, (evaluation) => evaluation.variant.opportunity),
    topVariants: [...eligible]
      .sort((left, right) => right.score - left.score || left.variant.id.localeCompare(right.variant.id))
      .slice(0, 25)
      .map((evaluation) => ({
        id: evaluation.variant.id,
        score: evaluation.score,
        channel: evaluation.variant.channel,
        niche: evaluation.variant.niche,
        opportunity: evaluation.variant.opportunity,
        opening: evaluation.variant.opening,
        tone: evaluation.variant.tone,
        cta: evaluation.variant.cta,
        personalization: evaluation.variant.personalization,
        linkPolicy: evaluation.variant.linkPolicy,
      })),
  };
}
