# Runbook de qualificação de canais do primeiro lote

## Objetivo

Transformar candidatos públicos em até cinco fichas elegíveis para aprovação humana, sem contato, sem listas compradas, sem alegações automáticas e sem confundir telefone público com autorização de WhatsApp.

A qualificação individual não autoriza envio. O contato continua bloqueado até o veredito global `REAL_MANUAL_PILOT_READY` da issue #117 e a aprovação explícita de Bruno F. Salustiano para cada ficha.

## Escopo atual

- categoria: manutenção e serviços técnicos;
- região: Campinas/SP e proximidades;
- shortlist sanitizada inicial: até dez candidatos;
- prioridades atuais para validação privada: `LF-TM-01`, `LF-TM-04`, `LF-TM-05` e `LF-TM-09`;
- lote final: no máximo cinco fichas completas;
- todos os candidatos e mensagens permanecem `NOT_SENT`;
- nenhum nome, e-mail, telefone, URL individual, mensagem integral ou payload bruto deve ser publicado em issue, PR, log ou artifact público.

## Etapa 1 — Identidade do negócio

Confirmar por pelo menos duas evidências coerentes quando possível:

- nome comercial e identidade empresarial;
- categoria e atividade atual;
- cidade ou região;
- endereço aproximado quando necessário para distinguir homônimos;
- perfil social oficial, site, agenda oficial ou cadastro empresarial;
- ausência de homônimo que possa causar contato incorreto.

Bloquear quando:

- nome e atividade são inconsistentes;
- o cadastro pertence a outro segmento;
- existem múltiplos negócios homônimos sem distinção segura;
- a fonte parece desatualizada, abandonada ou copiada;
- a identidade não pode ser vinculada com segurança ao canal.

## Etapa 2 — Oportunidade digital

A política v2 não exclui automaticamente uma empresa apenas porque ela possui site. Cada diagnóstico precisa de evidência objetiva, individual e não enganosa.

| Estado | Regra |
|---|---|
| `NO_SITE` | busca razoável não encontrou presença institucional própria; exige revisão humana |
| `THIRD_PARTY_ONLY` | depende de agenda, marketplace, diretório, rede social ou agregador de links |
| `WEAK_SITE` | site próprio existe, mas apresenta deficiência objetiva e relevante |
| `BROKEN_SITE` | falha técnica reproduzível, indisponibilidade ou recurso essencial quebrado |
| `WEAK_CONVERSION` | presença existe, mas há deficiência objetiva de clareza, CTA, contato ou jornada comercial |
| `NO_ACTIONABLE_OPPORTUNITY` | presença adequada ou evidência insuficiente; não contatar |
| `UNKNOWN` | diagnóstico ainda não demonstrado; manter em revisão |

Evidências aceitáveis incluem, conforme o caso:

- ausência de CTA ou contato essencial;
- informação comercial fundamental ausente;
- domínio ou página indisponível;
- recurso importante quebrado;
- conteúdo incompatível com a atividade atual;
- dependência exclusiva de página genérica de terceiro;
- hierarquia de conversão objetivamente fraca.

Não são aceitáveis:

- afirmar que o negócio “está perdendo clientes” sem prova;
- presumir baixa conversão apenas pela aparência;
- inventar métricas, tráfego, faturamento ou impacto financeiro;
- usar diagnóstico sintético como se fosse inspeção real;
- classificar automaticamente sem revisão humana.

## Etapa 3 — Hierarquia de fontes do canal

### Nível A — fonte oficial forte

- site institucional do próprio negócio;
- perfil social oficial com informação de contato;
- página oficial de agenda controlada pelo negócio;
- material fornecido diretamente pelo negócio;
- resposta recebida em canal oficial da Lead Finder Brasil.

### Nível B — fonte pública de apoio

- cadastro empresarial oficial;
- diretório conhecido que identifica claramente a empresa;
- associação comercial ou marketplace com identidade consistente.

Nível B isolado pode apoiar identidade, mas não aprova automaticamente a propriedade empresarial do e-mail.

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

Somente `BUSINESS + APPROVED` permite que a ficha avance para aprovação final.

Requisitos:

- sintaxe válida;
- contato pertence ao lead correto;
- origem suportada;
- uso empresarial demonstrável;
- decisão humana registrada;
- evidência fingerprintada sem payload bruto;
- ausência de opt-out e bloqueios;
- finalidade compatível com contato comercial individual pertinente.

Regras especiais:

- Gmail, Outlook ou outro domínio gratuito pode ser empresarial, mas exige prova específica de uso pelo negócio;
- domínio próprio não garante que a caixa pertença ao negócio selecionado;
- endereço encontrado somente em diretório permanece `UNKNOWN` até fonte adicional;
- endereço com aparência nominal ou pessoal permanece bloqueado sem demonstração de uso empresarial;
- não enviar mensagem de teste para verificar se a caixa existe;
- `BUSINESS_CANDIDATE` não equivale a `BUSINESS / APPROVED`.

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
- número empresarial em cadastro;
- operação manual por si só.

Sem autorização explícita, o telefone pode apoiar identidade, mas não pode ser usado para primeiro contato pelo WhatsApp.

## Etapa 6 — Supressões

Verificar antes da aprovação individual e novamente imediatamente antes da preparação:

- opt-out de e-mail;
- opt-out de WhatsApp;
- opt-out global;
- `do_not_contact`;
- `NAO_CONTATAR`;
- bloqueio administrativo;
- contato inválido;
- revisão humana rejeitada.

A regra mais restritiva vence. Nova evidência, nova autorização ou novo cadastro não reativa automaticamente uma supressão.

A existência de zero registros agregados em tabelas de supressão não substitui a consulta específica depois que o lead e o contato forem vinculados de forma privada.

## Etapa 7 — Duplicidade

Deduplicar por combinação de:

- identidade empresarial;
- endereço ou região;
- domínio ou perfil oficial;
- contato normalizado;
- identificador externo confiável;
- operador, grupo econômico ou unidade compartilhada quando relevante.

Quando duas fontes discordarem, manter uma única ficha em `NEEDS_REVIEW` e não criar duas oportunidades.

## Etapa 8 — Qualidade da mensagem

A mensagem permanece privada e `NOT_SENT`. Antes da aprovação, aplicar a rubrica versionada:

- evidência e relevância;
- clareza;
- personalização;
- conformidade e opt-out;
- brevidade e CTA.

Requisitos mínimos:

- nota total de pelo menos `8/10`;
- nenhuma dimensão em zero;
- identificação clara do remetente;
- finalidade comercial transparente;
- opt-out simples;
- WhatsApp no primeiro contato sem link, PDF, imagem, preço, proposta ou tracking até autorização explícita do destinatário;
- e-mail pode conter somente o link oficial de demonstrações quando usar `pilot-email-first-contact@v2`, com contato `BUSINESS / APPROVED` e diagnóstico individual de ausência de site oficial próprio;
- nenhuma alegação não sustentada pelo diagnóstico aprovado.

A exceção do e-mail v2 não permite URL individual de lead, encurtador, parâmetro de tracking, PDF, imagem, anexo, preço ou proposta. Qualquer outro template de primeiro contato permanece sem link.

## Etapa 9 — Decisão individual

| Decisão | Uso |
|---|---|
| `APROVADO_NOT_SENT` | ficha completa e elegível; ainda depende do gate global #117 |
| `NEEDS_REVIEW` | prova, canal, diagnóstico ou supressão ainda insuficiente |
| `REJECTED` | identidade, oportunidade ou canal inválido |
| `DO_NOT_CONTACT` | supressão, opt-out ou risco exige bloqueio |

`APROVADO_NOT_SENT` não representa envio nem permite contornar o gate global.

## Ficha mínima privada

- código sanitizado e ID interno;
- nome empresarial;
- categoria e região;
- identidade e atividade confirmadas;
- diagnóstico `NO_SITE`, `THIRD_PARTY_ONLY`, `WEAK_SITE`, `BROKEN_SITE` ou `WEAK_CONVERSION`;
- evidências primária e secundária;
- canal potencial;
- propriedade do e-mail;
- origem do fundamento;
- decisão humana do canal;
- estado das supressões;
- demonstração relacionada;
- mensagem versionada e nota da rubrica;
- decisão individual;
- próxima ação.

Nenhuma PII deve ser copiada para issue pública.

## Gate global obrigatório

Mesmo com uma ficha individual completa, o contato permanece bloqueado até a issue #117 comprovar:

- banco efetivo e histórico reconciliados;
- SHA implantado e CI verde no SHA exato;
- flags fail-closed efetivas;
- provider e egress desligados;
- restart, kill switch, backup, restore, rollback e smoke test;
- operador identificado;
- veredito explícito `REAL_MANUAL_PILOT_READY`.

## Controle de qualidade

Para cada ficha apresentada, um revisor deve responder “sim” a todas:

- [ ] negócio correto, ativo e sem homônimo não resolvido;
- [ ] oportunidade digital comprovada e não enganosa;
- [ ] contato pertence ao negócio;
- [ ] canal está explicitamente elegível;
- [ ] fonte é suficientemente confiável;
- [ ] supressões estão limpas na consulta específica;
- [ ] template e versão correspondem ao canal;
- [ ] mensagem atingiu pelo menos `8/10` e nenhuma dimensão ficou em zero;
- [ ] WhatsApp não contém link, PDF, imagem, preço, proposta ou tracking no primeiro contato;
- [ ] e-mail com link usa exclusivamente `pilot-email-first-contact@v2` e o URL oficial de demonstrações, sem tracking, anexo, preço ou proposta;
- [ ] aprovação não foi registrada como envio;
- [ ] ficha contém somente os dados necessários;
- [ ] gate global #117 continua respeitado.

## Critério de saída

Até cinco fichas podem seguir para aprovação final somente quando completas e classificadas como:

`FIRST_BATCH_LEADS_QUALIFIED`

Esse estado não autoriza contato. O envio somente poderá ocorrer manualmente após `REAL_MANUAL_PILOT_READY` e aprovação individual.