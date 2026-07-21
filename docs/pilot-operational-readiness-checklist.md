# Checklist de prontidão operacional do piloto

Base de referência: `main` em `239f10c177ea64407cda310baf2be425e5e0421f`.

Este documento organiza o trabalho restante para transformar as validações de CI em evidência operacional de homologação. Ele não autoriza coleta externa, scraping, envio, provider, webhook, SDK de mensageria, WhatsApp Web, n8n, dados reais ou deploy produtivo.

## Bloqueio arquitetural antes da homologação

A migration `0011_internal_pilot.sql` ainda não garante integralmente no PostgreSQL que:

- `pilot_manual_contacts.contact_id` pertença ao mesmo `lead_id` registrado no piloto;
- `pilot_timeline_events.lead_id`, quando preenchido, pertença ao respectivo `pilot_run_id`;
- futuras escritas SQL, imports ou rotas não criem relações cruzadas entre piloto, lead e contato.

O serviço atualmente aplica parte dessas verificações, mas o PostgreSQL deve ser a autoridade final da integridade.

Estado: `BLOCKED` até migration incremental, auditoria de registros existentes e testes PostgreSQL.

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

1. corrigir integridade referencial no PostgreSQL;
2. integrar a correção somente após CI e PostgreSQL real verdes;
3. provisionar a homologação;
4. executar gates técnicos com dados sintéticos;
5. revisar evidências e manter `PILOT_REAL_NOT_READY` diante de qualquer pendência;
6. configurar os canais comerciais dedicados;
7. solicitar aprovação humana final;
8. iniciar um ciclo manual com 20 leads, uma região e uma categoria.

## Critério de saída

O primeiro piloto real controlado só pode começar quando:

- a integridade referencial estiver garantida pelo PostgreSQL;
- todas as dez gates do preflight estiverem em `PASS`;
- o kill switch tiver sido comprovado;
- os canais comerciais dedicados estiverem configurados fora do Git;
- a mensagem manual estiver aprovada;
- não houver provider real, automação de WhatsApp ou egress externo habilitado.
