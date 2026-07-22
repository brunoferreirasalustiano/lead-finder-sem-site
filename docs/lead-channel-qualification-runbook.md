# Runbook de qualificação de canais do primeiro lote

## Objetivo

Transformar candidatos públicos em até cinco leads elegíveis para revisão humana, sem contato, sem listas compradas e sem confundir telefone público com autorização de WhatsApp.

## Escopo inicial

- categoria: barbearias;
- região: Campinas/SP e proximidades;
- até dez candidatos em triagem ativa;
- até cinco no lote final;
- contato real permanece bloqueado até aprovação individual.

## Etapa 1 — Identidade do negócio

Confirmar por pelo menos duas evidências coerentes quando possível:

- nome comercial;
- categoria;
- cidade e endereço aproximado;
- atividade recente;
- perfil social oficial, agenda oficial ou cadastro empresarial;
- ausência de homônimo que possa causar contato incorreto.

Bloquear quando:

- nome e atividade são inconsistentes;
- o cadastro pertence a outro segmento;
- existem múltiplos negócios homônimos sem forma segura de distinção;
- a fonte parece desatualizada ou abandonada.

## Etapa 2 — Status do site

Classificações:

| Estado | Regra |
|---|---|
| `SITE_OWNED_FUNCTIONAL` | domínio institucional próprio funcional; excluir do lote inicial |
| `BOOKING_PAGE_ONLY` | página de agenda de terceiro; pode continuar |
| `SOCIAL_ONLY` | apenas rede social; pode continuar |
| `LINK_AGGREGATOR_ONLY` | Linktree ou equivalente; pode continuar |
| `NO_STANDALONE_SITE_FOUND` | busca razoável não encontrou site próprio; continua em revisão |
| `UNKNOWN` | evidência insuficiente; não aprovar |

Uma página Booksy, agenda, diretório, Instagram ou Linktree não é automaticamente um site institucional próprio. Porém, ela também não prova que nenhum site existe.

## Etapa 3 — Hierarquia de fontes do canal

### Nível A — fonte oficial forte

- site institucional do próprio negócio;
- perfil social oficial com botão ou informação de contato;
- página oficial de agenda controlada pelo negócio;
- documento fornecido diretamente pelo negócio;
- resposta recebida no canal oficial da Lead Finder Brasil.

### Nível B — fonte pública de apoio

- cadastro empresarial oficial;
- diretório conhecido que identifica claramente a empresa;
- associação comercial ou marketplace com identidade consistente.

Nível B isolado pode apoiar identidade, mas não deve aprovar automaticamente a propriedade empresarial do e-mail.

### Nível C — fonte fraca ou rejeitada

- lista comprada;
- vazamento;
- agregador sem origem;
- página copiada;
- comentário de terceiro;
- dado pessoal sem vínculo empresarial demonstrável.

Fonte C nunca habilita contato.

## Etapa 4 — E-mail empresarial

### Classificação de propriedade

- `BUSINESS`: publicado para atendimento ou atividade da empresa;
- `PERSONAL`: identificado como endereço pessoal sem evidência de uso empresarial;
- `UNKNOWN`: propriedade ou finalidade incerta.

### Decisão humana

Somente `BUSINESS + APPROVED` habilita preparação por e-mail.

Requisitos:

- sintaxe válida;
- contato pertence ao lead correto;
- origem suportada;
- uso empresarial demonstrável;
- decisão humana registrada;
- evidência fingerprintada sem payload bruto;
- ausência de opt-out e bloqueios.

Regras especiais:

- Gmail, Outlook ou outro domínio gratuito pode ser empresarial, mas exige prova específica;
- domínio próprio não garante que a caixa pertence ao negócio selecionado;
- endereço encontrado somente em diretório permanece `UNKNOWN` até fonte adicional;
- endereço com aparência nominal/pessoal permanece bloqueado sem demonstração de uso empresarial;
- não enviar mensagem de teste para verificar se a caixa existe.

## Etapa 5 — WhatsApp

WhatsApp somente é elegível quando o destinatário autorizou contato comercial no canal para a finalidade aplicável.

Origens aceitas:

- `DIRECT_OPT_IN`;
- `FORM_OPT_IN`;
- `SIGNED_RECORD`.

Não são opt-in:

- número no Google;
- número no Instagram;
- número em site;
- número em diretório;
- botão público de WhatsApp;
- número empresarial em cadastro.

Sem autorização explícita, o telefone pode apoiar identidade, mas não pode ser usado para primeiro contato pelo WhatsApp.

## Etapa 6 — Supressões

Antes da aprovação e novamente antes de preparar:

- opt-out de e-mail;
- opt-out de WhatsApp;
- opt-out global;
- `do_not_contact`;
- `NAO_CONTATAR`;
- bloqueio administrativo;
- contato inválido;
- revisão humana rejeitada.

A regra mais restritiva vence. Nova evidência ou novo cadastro não reativa automaticamente uma supressão.

## Etapa 7 — Duplicidade

Deduplicar por combinação de:

- identidade empresarial;
- endereço/região;
- domínio ou perfil oficial;
- contato normalizado;
- identificador externo confiável.

Quando duas fontes discordarem, manter uma única ficha em `NEEDS_REVIEW` e não criar duas oportunidades.

## Etapa 8 — Decisão final

| Decisão | Uso |
|---|---|
| `APPROVED_FOR_MANUAL_CONTACT` | canal elegível, supressões limpas e revisão concluída |
| `NEEDS_REVIEW` | prova ainda insuficiente |
| `EXCLUDE_HAS_SITE` | site próprio funcional confirmado |
| `REJECTED` | identidade, segmento ou canal inválido |
| `DO_NOT_CONTACT` | supressão ou risco exige bloqueio |

## Ficha mínima privada

- ID interno;
- nome empresarial;
- categoria e região;
- status do site;
- fonte primária e secundária;
- canal potencial;
- propriedade do e-mail;
- origem do fundamento;
- decisão humana;
- estado das supressões;
- justificativa curta;
- próxima ação.

Nenhuma PII deve ser copiada para issue pública.

## Controle de qualidade

Para cada lead aprovado, um revisor deve responder “sim” a todas:

- [ ] negócio correto e ativo;
- [ ] sem site próprio funcional no escopo do piloto;
- [ ] contato pertence ao negócio;
- [ ] canal está explicitamente elegível;
- [ ] fonte é suficientemente confiável;
- [ ] supressões estão limpas;
- [ ] template corresponde ao canal;
- [ ] mensagem não contém link no primeiro contato;
- [ ] aprovação não foi registrada como envio;
- [ ] ficha contém apenas dados necessários.

## Critério de saída

Até cinco fichas podem seguir para aprovação final somente com decisão:

`FIRST_BATCH_LEADS_QUALIFIED`
