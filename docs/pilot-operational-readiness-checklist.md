# Checklist de prontidão operacional do piloto

Base de referência: `main` em `5051d54dd18689794732c2cec312da42d3f620b8`.

Este documento organiza o trabalho restante para transformar as validações de CI em evidência operacional de homologação. Ele não autoriza coleta externa, scraping, envio, provider, webhook, SDK de mensageria, WhatsApp Web, n8n, dados reais ou deploy produtivo.

## Integridade referencial

A integridade referencial do piloto foi reforçada pela migration incremental `0012`, integrada pela PR #61. O PostgreSQL passou a impedir relações cruzadas entre piloto, lead, contato e timeline, e a integração PostgreSQL real foi validada na CI da entrega.

Estado: `PASS` para a integridade referencial coberta pela PR #61.

Esse resultado não substitui o gate separado de backup/restore. A PR #69 ainda deve comprovar que bloqueios, opt-outs e `NAO_CONTATAR` posteriores ao backup permanecem suprimidos após restauração, incluindo escopo por canal e jobs de outbox associados por attempt.

## Ambiente de homologação

- [ ] VPS/VM Linux controlada disponível.
- [ ] Docker Engine e Compose instalados.
- [ ] usuário operacional sem login direto como root.
- [ ] firewall com somente SSH restrito; API e PostgreSQL sem exposição pública.
- [ ] repositório clonado no SHA aprovado.
- [ ] `.env.homologation` criado com permissão `600` e segredos locais novos.
- [ ] todos os flags externos mantidos em `false`.
- [ ] profile `n8n` não ativado.

## Gates técnicos

- [ ] `npm run pilot:real:preflight -- --env-file .env.homologation` inicia em `PILOT_REAL_NOT_READY`.
- [ ] `docker compose config` validado com os dois arquivos Compose.
- [ ] PostgreSQL sobe sem porta pública.
- [ ] migrations aplicadas duas vezes.
- [ ] API e worker iniciam em shadow mode.
- [ ] restart isolado da API preserva o kill switch.
- [ ] restart isolado do worker não cria efeito externo.
- [ ] lote sintético de 20 leads conclui com `externalEffects=0`.
- [ ] reexecução do lote sintético não duplica recursos.
- [ ] relatório de privacidade dos logs aprovado.
- [ ] backup e restore em banco separado aprovados.
- [ ] rollback não destrutivo aprovado.
- [ ] kill switch engage/release aprovado sem reinício automático.

## Gates comerciais e humanos

- [ ] região inicial definida.
- [ ] categoria única definida.
- [ ] mensagem manual aprovada e versionada.
- [ ] responsável operacional definido.
- [ ] e-mail dedicado configurado fora do versionamento.
- [x] número exclusivo e WhatsApp Business configurados fora do versionamento; consulte `docs/commercial-channel-config.md`.
- [ ] critérios de opt-out e `NAO_CONTATAR` revisados.
- [ ] nenhum segundo contato permitido após opt-out.

## Evidências obrigatórias

Cada evidência deve registrar:

- SHA exato;
- data/hora UTC;
- ambiente e arquitetura;
- comando executado sem segredos;
- resultado `PASS`, `FAIL`, `BLOCKED` ou `NOT RUN`;
- caminho do artefato sanitizado;
- responsável pela execução.

Nenhum gate indisponível pode ser promovido a `PASS`.

## Ordem de execução

1. corrigir e integrar a reconciliação de supressões da PR #69 somente após PostgreSQL real, CI e nova revisão verdes;
2. atualizar e integrar a PR documental #70 somente com CI verde;
3. provisionar a homologação;
4. executar gates técnicos com dados sintéticos;
5. revisar evidências e manter `PILOT_REAL_NOT_READY` diante de qualquer pendência;
6. confirmar os canais comerciais dedicados fora do Git;
7. solicitar aprovação humana final;
8. iniciar um ciclo manual pequeno, com uma região e uma categoria, antes de ampliar o lote.

## Critério de saída

O primeiro piloto real controlado só pode começar quando:

- a integridade referencial estiver garantida pelo PostgreSQL;
- a reconciliação pós-restore de supressões estiver aprovada;
- todas as gates aplicáveis do preflight estiverem em `PASS`;
- o kill switch tiver sido comprovado;
- os canais comerciais dedicados estiverem configurados fora do Git;
- a mensagem manual estiver aprovada;
- não houver provider real, automação de WhatsApp ou egress externo habilitado.