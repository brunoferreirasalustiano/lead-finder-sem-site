# Lead Finder Brasil — Caminho crítico até os primeiros leads reais

> Este documento organiza a sequência mínima para chegar ao primeiro lote real controlado. Não autoriza deploy, provider, webhook, egress, coleta externa, mensagem ou contato.

## Estado de entrada

- `REAL_MANUAL_PILOT_BLOCKED`;
- `MESSAGES=NOT_SENT`;
- contatos enviados: `0`;
- opt-out, `DO_NOT_CONTACT` e `NAO_CONTATAR` preservados;
- PR #128 documenta a visão futura nacional e a meta posterior de 60 mensagens efetivamente enviadas por dia;
- a PR #130 corrigiu o advisory alto `GHSA-r28c-9q8g-f849` com atualização lockfile-only de `postcss 8.5.16` para `8.5.23`;
- a CI #477 da PR #130 foi integralmente verde nos perfis `supabase-render` e `oracle-vps`, incluindo audit, integração PostgreSQL, restore-compose e multiarch;
- a issue #129 foi concluída e `DEPENDENCY_AUDIT_CLEAN` foi restabelecido na `main` pelo squash `3464f91b1668fdb9f7f99b7accdac61d05867b71`.

## Objetivo imediato

Liberar um primeiro lote manual pequeno e auditável para validar qualidade, canal, resposta e interesse comercial, sem antecipar a escala futura de 60 mensagens diárias.

## Ordem obrigatória

### Gate 1 — Dependências e CI — concluído

1. pacote e advisory identificados: `postcss` / `GHSA-r28c-9q8g-f849`;
2. dependência classificada como transitiva e apenas de desenvolvimento no lockfile;
3. atualização mínima aplicada sem `--force`;
4. correção mantida separada da documentação na PR #130;
5. typecheck, lint, testes, cobertura, build, audit, integração, restore e multiarch aprovados;
6. CI verde nos dois perfis.

**Saída comprovada:** `DEPENDENCY_AUDIT_CLEAN`.

### Gate 2 — Reconciliar e integrar a documentação

1. confirmar que a PR #128 não afirma prontidão operacional inexistente;
2. confirmar cobertura nacional futura e meta final de 60 mensagens enviadas por dia;
3. manter Campinas apenas como recorte inicial do piloto;
4. preservar a distinção entre volume descoberto, mensagem enviada, resposta, demonstração, proposta e venda;
5. integrar somente após CI verde e revisão sem finding material.

**Saída:** visão futura integrada sem alteração do estado operacional.

### Gate 3 — Ambiente efetivo de homologação

Verificar somente por leitura autenticada, sem revelar valores:

- serviço e branch corretos;
- auto-deploy desligado;
- SHA live;
- `DATABASE_URL` apontando ao projeto Supabase esperado;
- `DEPLOYMENT_PROFILE=supabase-render`;
- `DRY_RUN=true`;
- `SHADOW_MODE_ENABLED=true`;
- `REAL_SEND_ENABLED=false`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_PROVIDER_CONFIGURED=false`;
- `COLLECTION_EGRESS_ENABLED=false`.

Ausência de acesso ou evidência mantém `NÃO_VERIFICADO`.

**Saída:** `RENDER_EFFECTIVE_FAIL_CLOSED_VERIFIED`.

### Gate 4 — Plano reversível de implantação

Preparar, sem executar:

- SHA aprovado;
- backup aplicável;
- procedimento de restore;
- rollback para SHA anterior;
- health checks;
- smoke test;
- restart;
- kill switch;
- comprovação de ausência de egress;
- critérios de interrupção.

Qualquer deploy exige autorização específica posterior.

**Saída:** `CONTROLLED_DEPLOY_PLAN_READY`.

### Gate 5 — Qualificação privada do lote

Priorizar os códigos:

- `LF-TM-01`;
- `LF-TM-04`;
- `LF-TM-05`;
- `LF-TM-09`.

O mapeamento privado original desses códigos não foi recuperado nas cópias atuais do tracker. Os campos de identidade, atividade, fontes e canal permanecem vazios. Portanto, a continuidade exige recuperar a origem ou substituir os códigos antigos por uma shortlist nova, verificável e registrada apenas no acervo privado.

Para cada ficha:

1. confirmar identidade empresarial;
2. confirmar atividade e território atendido;
3. registrar fontes mínimas;
4. eliminar homônimo, filial duplicada e conflito de dados;
5. comprovar a oportunidade digital;
6. classificar canal empresarial e sua origem;
7. consultar opt-out por canal e global;
8. consultar `DO_NOT_CONTACT`;
9. consultar `NAO_CONTATAR`;
10. consultar bloqueio administrativo;
11. aplicar rubrica mínima;
12. obter decisão humana individual.

Nenhuma identidade será reconstruída por suposição. Canal público não equivale a opt-in de WhatsApp.

**Saída:** até cinco fichas `APPROVED_FOR_MANUAL_REVIEW` ou rejeitadas com motivo.

### Gate 6 — Mensagem e operação manual

Antes do primeiro contato:

- template versionado e aprovado;
- remetente identificado;
- WhatsApp curto e sem link até autorização explícita do destinatário;
- e-mail empresarial público pode usar somente `pilot-email-first-contact@v2` com o link oficial `https://brunoferreirasalustiano.github.io/lead-finder-demos/`, depois da confirmação individual de ausência de site oficial próprio;
- nenhum outro link, encurtador, tracking, PDF, imagem, anexo, preço ou proposta no primeiro contato;
- finalidade clara;
- opt-out disponível;
- frequência limitada;
- nenhuma sequência automática;
- nenhum WhatsApp Web automatizado;
- nenhum compromisso comercial assumido pela IA;
- registro de envio e resultado preparado.

A exceção do e-mail v2 não autoriza envio: o consumidor Gmail, o gate global #117 e a aprovação humana individual continuam obrigatórios.

**Saída:** `FIRST_MANUAL_MESSAGE_PACKET_READY`.

### Gate 7 — Decisão final

Emitir somente um veredito:

- `REAL_MANUAL_PILOT_READY`; ou
- `REAL_MANUAL_PILOT_BLOCKED`.

O estado `READY` exige todos os gates comprovados e aprovação individual por destinatário. Sem isso, `NOT_SENT` permanece obrigatório.

## Métricas do primeiro lote

Separar rigorosamente:

- candidatos descobertos;
- empresas confirmadas;
- oportunidades aprovadas;
- canais aprovados;
- mensagens enviadas;
- entregas confirmadas;
- respostas;
- respostas positivas;
- autorizações para demonstração;
- propostas;
- vendas;
- opt-outs e reclamações.

## Relação com a meta futura de 60 mensagens diárias

A meta de 60 mensagens efetivamente enviadas por dia pertence a uma fase posterior. O caminho de escala deverá ser:

1. primeiro lote manual pequeno;
2. aproximadamente 5–10 mensagens por dia;
3. aproximadamente 15–30 mensagens por dia;
4. 60 mensagens por dia.

Cada aumento exige evidência de qualidade, reputação do canal, baixa reclamação, opt-out confiável, capacidade de atendimento e estabilidade operacional.

## Restrições atuais

Até 28 de julho de 2026 às 14:00 no fuso `America/Sao_Paulo`, nenhuma etapa deverá depender do Codex. Após essa janela, o Codex não será executado automaticamente; será apenas indicada a tarefa de maior valor e o modelo adequado.
