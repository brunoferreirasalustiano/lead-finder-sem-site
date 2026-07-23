# Checklist — piloto manual controlado

## Regra de uso

Este checklist não autoriza contato por si só. Todos os itens obrigatórios precisam estar comprovados na issue #117, o veredito global precisa ser `REAL_MANUAL_PILOT_READY` e cada ficha precisa de aprovação individual de Bruno F. Salustiano.

Até esse momento:

- leads e mensagens permanecem `NOT_SENT`;
- nenhum provider, worker, webhook ou automação pode enviar externamente;
- WhatsApp exige opt-in explícito;
- nenhuma PII deve ser publicada em issue, PR, log ou artifact.

## 1. Baseline e CI

- [ ] SHA da `main` registrado.
- [ ] SHA efetivamente implantado registrado.
- [ ] Branch e fonte de deploy confirmadas.
- [ ] CI verde no SHA exato implantado.
- [ ] Typecheck, lint, testes, cobertura, build e auditoria aprovados.
- [ ] Integração PostgreSQL, mensageria manual, supressões e restart lógico aprovados.
- [ ] API e worker validados para as arquiteturas aplicáveis.

## 2. Banco e histórico

- [ ] Banco efetivamente usado pelo Render confirmado sem expor connection string.
- [ ] Histórico de migrations comparado com os objetos existentes.
- [ ] Divergência de histórico reconciliada sem reaplicar DDL existente.
- [ ] Ponto restaurável preservado antes da reconciliação.
- [ ] Catálogo, constraints, funções, triggers e índices revisados após a reconciliação.
- [ ] RLS e grants revisados após a reconciliação.
- [ ] Contagens relevantes registradas de forma sanitizada.
- [ ] Advisors de segurança revisados.
- [ ] Advisors de performance tratados somente com benchmark, sem mudança para silenciar aviso.

## 3. Homologação efetiva

- [ ] Workspace e service ID confirmados.
- [ ] Auto-deploy desligado.
- [ ] `DRY_RUN=true` confirmado no ambiente efetivo.
- [ ] `SHADOW_MODE_ENABLED=true` confirmado.
- [ ] `REAL_SEND_ENABLED=false` confirmado.
- [ ] `REAL_PROVIDERS_ENABLED=false` confirmado.
- [ ] `REAL_PROVIDER_CONFIGURED=false` confirmado.
- [ ] `COLLECTION_EGRESS_ENABLED=false` confirmado.
- [ ] Health/live aprovado.
- [ ] Health/ready aprovado.
- [ ] Endpoint interno rejeita acesso sem autenticação.
- [ ] Logs sanitizados revisados.
- [ ] Ausência observada de egress Meta, SMTP, OpenAI e webhooks comprovada.

## 4. Resiliência

- [ ] Restart controlado comprovado no ambiente efetivo.
- [ ] Kill switch testado sem contato ou envio externo.
- [ ] Backup aplicável confirmado.
- [ ] Restore controlado comprovado.
- [ ] Rollback comprovado.
- [ ] Smoke test pós-rollback aprovado.
- [ ] Evidências sanitizadas registradas.

## 5. Seleção do lote

- [ ] Categoria e região confirmadas.
- [ ] Shortlist limitada e sanitizada.
- [ ] No máximo cinco fichas privadas completas.
- [ ] Identidade, atividade e região confirmadas por ficha.
- [ ] Homônimos e duplicidades eliminados.
- [ ] Diagnóstico classificado como `NO_SITE`, `THIRD_PARTY_ONLY`, `WEAK_SITE`, `BROKEN_SITE` ou `WEAK_CONVERSION`.
- [ ] Diagnóstico sustentado por evidência objetiva e individual.
- [ ] Nenhuma alegação de conversão, perda ou faturamento foi inventada.
- [ ] Demonstração relacionada validada.

## 6. Canal

- [ ] Contato pertence ao negócio correto.
- [ ] Origem do canal registrada.
- [ ] Fonte classificada e suficientemente confiável.
- [ ] E-mail classificado `BUSINESS` e decisão humana `APPROVED`, quando aplicável.
- [ ] `BUSINESS_CANDIDATE` não foi tratado como aprovado.
- [ ] Endereço pessoal ou `UNKNOWN` foi rejeitado.
- [ ] WhatsApp possui `DIRECT_OPT_IN`, `FORM_OPT_IN` ou `SIGNED_RECORD`, quando aplicável.
- [ ] Telefone público não foi tratado como opt-in.
- [ ] Nenhum canal elegível resulta em não contatar.

## 7. Supressões e LGPD

Verificar por lead e por contato, antes da aprovação e novamente antes da preparação:

- [ ] opt-out por canal;
- [ ] opt-out global;
- [ ] `do_not_contact`;
- [ ] `NAO_CONTATAR`;
- [ ] bloqueio administrativo;
- [ ] contato inválido;
- [ ] decisão humana rejeitada.

Controles:

- [ ] A regra mais restritiva venceu.
- [ ] Nenhuma nova evidência reativou automaticamente uma supressão.
- [ ] Finalidade, necessidade e minimização foram respeitadas.
- [ ] Nenhum payload bruto ou dado desnecessário foi persistido ou publicado.

## 8. Mensagem

- [ ] Template e versão registrados.
- [ ] Mensagem individualizada para o lead correto.
- [ ] Remetente e Lead Finder Brasil identificados.
- [ ] Finalidade comercial transparente.
- [ ] Origem do e-mail informada quando aplicável.
- [ ] Opt-out simples presente.
- [ ] Diagnóstico citado somente quando comprovado.
- [ ] Sem urgência artificial, pressão, promessa ou garantia enganosa.
- [ ] Sem link no primeiro contato.
- [ ] Sem PDF, imagem, preço, proposta, pixel ou tracking.
- [ ] Nota mínima `8/10` na rubrica.
- [ ] Nenhuma dimensão da rubrica em zero.
- [ ] Texto integral armazenado somente no pacote privado.

## 9. Aprovação individual

- [ ] Ficha apresentada a Bruno F. Salustiano.
- [ ] Decisão registrada como `APROVADO_NOT_SENT`, `NEEDS_ADJUSTMENT`, `REJEITADO` ou `DO_NOT_CONTACT`.
- [ ] Data/hora e operador registrados.
- [ ] Janela manual planejada registrada.
- [ ] Aprovação não foi registrada como envio.
- [ ] Ficha `APROVADO_NOT_SENT` continua bloqueada enquanto a issue #117 não estiver pronta.

## 10. Execução manual

Somente após `REAL_MANUAL_PILOT_READY` e aprovação individual:

- [ ] Revalidar supressões imediatamente antes da preparação.
- [ ] Preparar usando o contato persistido e a versão aprovada.
- [ ] Confirmar novamente canal, mensagem e lead.
- [ ] Abrir exclusivamente o cliente oficial.
- [ ] Registrar `OPENED` sem afirmar envio.
- [ ] Enviar ou cancelar manualmente.
- [ ] Registrar `SENT_CONFIRMED` somente após confirmação humana.
- [ ] Manter `NOT_SENT` quando cancelado ou não enviado.
- [ ] Registrar resposta, opt-out, reunião, proposta, venda ou encerramento somente quando realmente ocorrer.
- [ ] Não criar follow-up automático.

## 11. Critérios de interrupção

Interromper o lote imediatamente em caso de:

- [ ] envio originado pelo sistema;
- [ ] provider ou egress inesperado;
- [ ] duplicidade de abordagem;
- [ ] contato sem origem ou elegibilidade comprovada;
- [ ] opt-out, `DO_NOT_CONTACT` ou `NAO_CONTATAR` ignorado;
- [ ] divergência entre CRM e histórico append-only;
- [ ] exposição de PII, segredo ou payload bruto;
- [ ] falha de kill switch, backup, restore ou rollback;
- [ ] SHA ou configuração divergente do aprovado;
- [ ] qualquer dúvida material sobre identidade, canal ou diagnóstico.

## 12. Encerramento e métricas

- [ ] Contagens absolutas registradas por lote.
- [ ] `SENT_CONFIRMED` separado de `OPENED` e `NOT_SENT`.
- [ ] Respostas positivas, negativas e opt-outs registrados separadamente.
- [ ] Entrega, leitura e abertura não foram alegadas sem provider ou tracking.
- [ ] Denominador zero tratado como `NOT_RUN`.
- [ ] Tempo humano, erros e fricções operacionais registrados.
- [ ] Incidentes e violações de gate permaneceram em zero ou o lote foi interrompido.
- [ ] Recomendações do ciclo seguinte registradas sem automatizar novo contato.

## Veredito

Somente um estado pode liberar o início do primeiro lote:

`REAL_MANUAL_PILOT_READY`

Qualquer item obrigatório pendente, `FAIL`, `NÃO COMPROVADO` ou restritivo mantém:

`REAL_MANUAL_PILOT_BLOCKED`