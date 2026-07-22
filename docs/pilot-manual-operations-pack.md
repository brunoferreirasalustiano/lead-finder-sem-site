# Pacote operacional — piloto manual controlado

## Finalidade

Este documento organiza o primeiro ciclo comercial manual do Lead Finder Brasil. Ele não autoriza coleta automática, scraping, disparo em massa, WhatsApp Web automatizado, provider real, OpenAI real, webhook público ou envio pelo worker.

O piloto começa com um lote pequeno, revisado individualmente e operado por uma pessoa. O objetivo é validar o fluxo comercial e a qualidade das demonstrações sem comprometer privacidade, reputação ou segurança.

## Pré-condições obrigatórias

Antes de selecionar qualquer negócio:

- PR #69 integrada com reconciliação pós-restore aprovada;
- CI da `main` verde;
- ambiente de homologação em `DRY_RUN=true`;
- `REAL_SEND_ENABLED=false`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_PROVIDER_CONFIGURED=false`;
- kill switch testado;
- WhatsApp Business oficial configurado fora do Git;
- mensagem manual versionada e aprovada;
- critérios de opt-out e `NAO_CONTATAR` revisados;
- operador identificado por ID técnico, sem nome completo em evidências públicas.

Se qualquer item estiver ausente, o lote permanece `BLOCKED`.

## Escopo do primeiro lote

- quantidade inicial: até 5 negócios;
- uma única cidade ou região;
- uma única categoria;
- seleção manual;
- nenhuma importação em massa;
- nenhuma lista comprada;
- nenhum contato sem revisão individual.

A ampliação para 20–30 negócios só pode ocorrer depois da análise do primeiro lote e de um veredito humano explícito.

## Critérios de elegibilidade

Um negócio só pode entrar no lote quando todos os critérios abaixo forem confirmados:

1. existe indício público de ausência de site ou presença digital insuficiente;
2. o indício foi revisado manualmente e não tratado como certeza automática;
3. o negócio está ativo e possui canal público de contato compatível com o piloto;
4. o contato pertence ao próprio negócio;
5. não existe `NAO_CONTATAR`;
6. não existe bloqueio global;
7. não existe opt-out global;
8. não existe opt-out do canal WhatsApp;
9. o contato não está marcado como inválido;
10. não existe contato anterior em aberto que torne nova abordagem inadequada;
11. a demonstração escolhida é pertinente ao segmento;
12. a mensagem não contém alegação não comprovada.

Qualquer dúvida resulta em `REVISAO_HUMANA` e impede contato.

## Ficha de revisão humana

A ficha deve registrar somente identificadores técnicos e dados mínimos:

- `pilotRunId`;
- `leadId`;
- `contactId`;
- `reviewId`;
- categoria;
- região ampla;
- motivo da elegibilidade;
- demonstração sugerida;
- template e versão;
- decisão `APROVADO`, `REJEITADO` ou `REVISAO_HUMANA`;
- data/hora UTC;
- ID técnico do operador.

Não registrar em evidências públicas:

- telefone completo;
- e-mail completo;
- nome completo do contato;
- mensagem integral enviada;
- link `wa.me`;
- token;
- segredo;
- payload bruto;
- print contendo PII.

## Fluxo manual assistido

1. revisar o lead e o contato;
2. confirmar elegibilidade e ausência de supressão;
3. escolher o template aprovado;
4. gerar a preparação manual;
5. abrir o WhatsApp Business por ação humana;
6. confirmar manualmente se houve contato;
7. registrar o resultado separadamente;
8. aplicar imediatamente opt-out, contato inválido ou `NAO_CONTATAR` quando necessário;
9. nunca interpretar abertura do link como mensagem enviada;
10. nunca repetir contato automaticamente.

## Resultados permitidos

- `OPENED` — o fluxo foi aberto, sem prova de envio;
- `NOT_OPENED` — o fluxo não foi aberto;
- `CONTACTED` — o operador confirmou contato manual;
- `NO_RESPONSE` — não houve resposta dentro do período definido;
- `INTERESTED` — demonstrou interesse;
- `NOT_INTERESTED` — recusou a proposta sem pedir bloqueio;
- `OPT_OUT` — pediu para não receber novos contatos;
- `INVALID_CONTACT` — canal incorreto, inexistente ou pertencente a terceiro;
- `FAILED` — falha operacional;
- `CANCELLED` — operação interrompida antes do contato.

`OPT_OUT` e `INVALID_CONTACT` devem bloquear qualquer nova tentativa automática. `NAO_CONTATAR` é permanente até reativação explícita e autorizada pelo fluxo próprio.

## Regra de contato e acompanhamento

- não usar urgência artificial;
- não alegar que o negócio “não tem site” como fato sem confirmação;
- não prometer venda, tráfego, ranking ou resultado;
- não enviar link no primeiro contato sem autorização do destinatário;
- não insistir após recusa;
- não realizar follow-up automático;
- qualquer follow-up manual futuro exige política e aprovação específicas;
- qualquer pedido para parar deve ser tratado como opt-out imediatamente.

## Procedimento de incidente

Engatar o kill switch e interromper o lote quando ocorrer:

- mensagem enviada ao contato errado;
- segundo contato após opt-out;
- exposição de PII em logs ou evidências;
- token ou segredo exposto;
- comportamento inesperado do worker;
- provider ou egress ativado;
- duplicidade de preparação ou resultado;
- dúvida sobre integridade do banco;
- reclamação relevante do destinatário.

Após o incidente:

1. manter API e worker parados quando aplicável;
2. preservar evidência sanitizada;
3. registrar correlation ID e IDs técnicos;
4. avaliar alcance;
5. corrigir a causa raiz;
6. comprovar regressão por teste;
7. liberar somente após novo gate humano.

## Métricas mínimas do lote

- negócios revisados;
- negócios aprovados;
- contatos preparados;
- contatos confirmados manualmente;
- respostas;
- interessados;
- não interessados;
- opt-outs;
- contatos inválidos;
- incidentes;
- demonstrações autorizadas para envio;
- propostas solicitadas;
- conversões confirmadas.

Nenhuma métrica pode ser inferida a partir da abertura de link. Conversão exige registro humano auditável.

## Veredito do lote

O lote termina com um destes estados:

- `PILOT_MANUAL_BATCH_APPROVED`;
- `PILOT_MANUAL_BATCH_NEEDS_ADJUSTMENT`;
- `PILOT_MANUAL_BATCH_STOPPED`;
- `PILOT_MANUAL_BATCH_BLOCKED`.

A ampliação do lote exige:

- zero contato após opt-out;
- zero duplicidade;
- zero efeito externo automático;
- evidências sanitizadas;
- análise humana das mensagens e respostas;
- aprovação explícita da próxima quantidade.