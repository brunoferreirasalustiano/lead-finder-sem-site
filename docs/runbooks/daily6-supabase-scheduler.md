# Scheduler Daily-6 via Supabase

## Objetivo e limites

O Supabase Cron acorda uma Edge Function nos horários naturais `09:07`, `13:07` e `16:07` de `America/Sao_Paulo`. A função faz um GET de liveness no Render e dispara o workflow Daily-6 pinado no GitHub. Ela não executa discovery, provider, Gmail, `/collect` ou `/run-slot`.

O cron, a configuração interna e a nova fonte GitHub nascem desativados. Não existe catch-up. Uma resposta ambígua do GitHub é terminal e não pode ser repetida.

## Segredos e permissões

Edge Function secrets, somente no Supabase HML:

- `DAILY6_SCHEDULER_INVOKE_SECRET`: segredo dedicado, no mínimo 32 caracteres;
- `DAILY6_GITHUB_APP_ID`;
- `DAILY6_GITHUB_APP_INSTALLATION_ID`;
- `DAILY6_GITHUB_APP_PRIVATE_KEY_PKCS8`: chave privada PKCS8; nunca registrar ou versionar;
- `DAILY6_HML_API_URL`: deve ser exatamente o host HML aprovado.

Se a chave do GitHub App estiver em outro envelope PEM, converta-a localmente
para PKCS8 antes de inseri-la no secret manager da Edge Function e remova os
arquivos locais depois:

```sh
openssl pkcs8 -topk8 -nocrypt -in github-app.pem -out github-app-pkcs8.pem
```

O valor nunca deve ser commitado, impresso, anexado a artifact ou colocado em
variável pública. A Edge Function aceita somente o envelope `BEGIN PRIVATE KEY`
(PKCS8).

Vault HML:

- `daily6_scheduler_invoke_secret`: o mesmo segredo dedicado usado pela função.

O GitHub App deve ser instalado somente em `brunoferreirasalustiano/lead-finder-sem-site`, com `Metadata: read` e `Actions: write`. Não conceder Contents write, Administration, Issues, Pull requests ou acesso a outros repositórios.

GitHub Environment `hml-discovery`:

- `DAILY6_GITHUB_SCHEDULE_ENABLED=true` e `DAILY6_SUPABASE_SCHEDULER_ENABLED=false` antes do cutover;
- `DAILY6_SUPABASE_DISPATCH_ACTOR`: login exato do GitHub App;
- demais secrets Daily-6 permanecem inalterados.

## Ordem de implantação

1. Merge protegido da migration `0070` e Edge Function na HML, fora de qualquer janela Daily-6.
2. Capturar o SHA final da HML, atualizar o pin na PR do workflow em `main` e só então fazer seu merge protegido. Durante esse intervalo, qualquer schedule com SHA divergente deve falhar fechado.
3. Aplicar `0070` duas vezes no PostgreSQL descartável; uma vez no Supabase HML após revisão.
4. Verificar `PUBLIC`, `anon` e `authenticated` sem acesso; a role de discovery recebe apenas EXECUTE nas funções opacas.
5. Implantar a Edge Function com `verify_jwt=false`; o bearer dedicado é a fronteira de autenticação.
6. Provisionar os secrets sem stdout, artifacts ou arquivos.
7. Executar exatamente um GET autenticado na função. PASS exige `schedulerAuth`, `githubAppAuth`, `workflowAccess`, `ledgerAccess` e `hmlConfiguration`, todos `PASS`, com `sideEffects=0`.
8. Fora de qualquer janela Daily-6 e sem run enfileirado, desligar o GitHub schedule, ligar a fonte Supabase e só então ativar o cron e a configuração interna.
9. Observar o próximo slot natural. Não usar workflow dispatch humano para criar um slot.

## Cutover atômico operacional

Antes do cutover, confirme:

- HML, Render e pin do scheduler no mesmo SHA;
- readiness 200;
- autorização operacional válida;
- migration e ACL hospedadas;
- smoke GET sem efeitos;
- nenhuma execução Daily-6 queued ou in progress.

Estado final esperado:

```text
DAILY6_GITHUB_SCHEDULE_ENABLED=false
DAILY6_SUPABASE_SCHEDULER_ENABLED=true
lead_finder_internal.daily6_scheduler_settings.enabled=true
cron.job.active=true
```

Nunca deixe as duas fontes ativas. A identidade única do ledger e a claim do workflow são defesa em profundidade, não justificativa para split-brain.

## Rollback

Em erro, nesta ordem:

1. desativar `cron.job.active`;
2. definir `daily6_scheduler_settings.enabled=false`;
3. definir `DAILY6_SUPABASE_SCHEDULER_ENABLED=false`;
4. manter o GitHub schedule desligado até confirmar que não há dispatch ambíguo ou workflow ativo;
5. somente depois, e fora das janelas, restaurar `DAILY6_GITHUB_SCHEDULE_ENABLED=true`.

Não apagar o ledger. Não reutilizar nonce, correlation ID ou request identity. Não fazer catch-up.

## Evidência mínima

- cron e configuração desativados após migration;
- GET preflight único com zero side effects, acesso read-only ao ledger e configuração HML válida;
- um `event=workflow_dispatch` cujo ator seja o GitHub App e cujo nonce seja consumido uma vez;
- `WORKFLOW_SUCCEEDED` ou `WORKFLOW_FAILED` terminal no ledger;
- nenhuma duplicidade e nenhum estado ambíguo;
- auditoria separada de Gmail SENT e ledger para qualquer envio comercial.
