# Estado operacional consolidado

**Snapshot da auditoria:** 6 de agosto de 2026  
**Repositório oficial:** `brunoferreirasalustiano/lead-finder-sem-site`  
**Branch oficial de produção:** `main`  
**Branch de homologação:** `hml/render-supabase-plan-b`  
**HEAD da HML observado no snapshot:** `66ef53e464bc8aa06ab67d2cf947087b4c2903bd`  
**Render live verificado:** `05a2696cf03ada5bc4d71cd0a94cd9dfd6bb3dec`  
**Estado comercial:** `REAL_MANUAL_PILOT=RECONCILIATION_REQUIRED`  
**Produção automática:** `AUTOMATED_COMMERCIAL_PRODUCTION=NO_GO`

Os SHAs, contagens e relações entre branches neste documento são evidências históricas do snapshot de 6 de agosto de 2026. Eles não devem ser interpretados como ponteiros dinâmicos após novos commits, merges, migrations ou deploys.

Este documento substitui afirmações históricas de que migrations `0021–0027` estavam pendentes, de que o SHA live não havia sido revalidado, de que o Supabase possuía zero policies e de que nenhuma mensagem comercial real havia sido enviada.

## Veredito executivo

A HML estava significativamente divergente da `main`: `153` commits à frente e `1` atrás na revalidação de 6 de agosto de 2026. O estado recente deve ser verificado por branch, SHA, PR e ambiente, sem tratar a `main` como fonte única.

O ambiente hospedado permanecia fail-closed para produção comercial automática. Entretanto, a conta operacional do Gmail apresentava atividade manual fora do runtime. Essa operação precisa ser reconciliada antes de um piloto real repetível.

A PR #209 havia sido integrada à HML, mas sua migration hospedada e os bounces ainda não tinham sido revalidados/reconciliados. A PR #215 permanecia aberta, atrás da HML e com CI falhando no snapshot.

Estados preservados:

```text
REAL_SEND_ENABLED=false
REAL_PROVIDERS_ENABLED=false
AUTOMATED_COMMERCIAL_PRODUCTION=NO_GO
REAL_MANUAL_PILOT=RECONCILIATION_REQUIRED
```

## Git e implantação

### Branches

- `main`: branch oficial de produção;
- `hml/render-supabase-plan-b`: branch de homologação;
- divergência observada no snapshot: HML `153` commits à frente e `1` atrás da `main`;
- HEAD da HML observado no snapshot: `66ef53e464bc8aa06ab67d2cf947087b4c2903bd`;
- branch da PR #216: `docs/reconcile-current-project-status-20260806`, mantida Draft e sem merge no momento do snapshot.

### Render

Última verificação autenticada somente leitura:

- serviço `lead-finder-api-hml`: existente;
- branch: `hml/render-supabase-plan-b`;
- auto-deploy: desligado;
- health check: `/health/ready`;
- deploy: `live`;
- SHA live: `05a2696cf03ada5bc4d71cd0a94cd9dfd6bb3dec`;
- runner `lead-finder-email-test-runner-once`: implantado, porém inerte por padrão e condicionado a ativação explícita.

O SHA live verificado era anterior ao merge da PR #209. Portanto, ele não comprovava que a migration `0041` ou o código de supressão estivessem implantados.

Nenhum deploy, restart, alteração de variável ou secret foi executado nesta reconciliação documental.

## Supabase e migrations

Projeto verificado na última auditoria autenticada:

- nome: `lead-finder-brasil-homologacao`;
- project ref: `ondvzdvlwntrnieodifi`;
- estado observado: `ACTIVE_HEALTHY`;
- PostgreSQL observado: `17.6`.

Registries:

- `public.schema_migrations`: sequência local registrada até `0027` na última auditoria;
- `supabase_migrations.schema_migrations`: aplicações equivalentes a `0035`–`0040` observadas;
- os registries são separados e continuam exigindo reconciliação antes de nova aplicação;
- `0041_email_delivery_suppression.sql`: integrada à HML, aplicação hospedada `NOT_VERIFIED` após o merge;
- `0042_restricted_manual_email_consumer.sql`: somente na PR #215, não integrada e não hospedada.

Não interpretar a existência do arquivo SQL no Git como migration aplicada.

## Pull requests

### PR #209 — supressão de entrega

- estado no snapshot: `MERGED`;
- merge na HML: 6 de agosto de 2026;
- merge commit/HEAD da HML naquele momento: `66ef53e464bc8aa06ab67d2cf947087b4c2903bd`;
- migration: `0041_email_delivery_suppression.sql`;
- integração HML: `IN_HML`;
- integração `main`: `NOT_IMPLEMENTED`;
- aplicação hospedada: `NOT_VERIFIED`;
- reconciliação de bounces: pendente.

A capacidade implementa registro append-only e idempotente de `HARD_BOUNCE`, `INVALID_CONTACT`, `OPT_OUT` e `COMPLAINT`. A integração na HML não significa que a proteção já esteja ativa no Supabase hospedado.

### PR #215 — consumidor Gmail restrito

- estado no snapshot: aberta;
- revisão no snapshot: Ready for Review;
- base: `hml/render-supabase-plan-b`;
- HEAD observado: `7b480fad251cfcf8c263fa3522b192e13e22105e`;
- relação com a HML observada: `25` commits à frente e `10` atrás;
- mergeabilidade observada: mergeável;
- CI no HEAD observado: falha;
- Deployment smoke no HEAD observado: sucesso;
- migration: `0042_restricted_manual_email_consumer.sql`;
- integração HML: não;
- aplicação hospedada: não.

O corpo da PR ainda declarava “PR Draft”, mas o estado observado era Ready for Review. Antes de integração, a branch deve ser atualizada sobre a HML atual, incluindo a PR #209, e a CI precisa ficar verde no SHA exato.

### PR #216 — reconciliação documental

- estado no snapshot: aberta;
- revisão no snapshot: Draft;
- base: `hml/render-supabase-plan-b`;
- escopo: somente `README.md` e `docs/current-operational-status.md`;
- merge: não realizado no snapshot.

## Gmail e reconciliação

Verificação agregada somente leitura no período iniciado em 3 de agosto de 2026:

```text
COMMERCIAL_MESSAGES_SENT=76
DELIVERY_FAILURE_NOTIFICATIONS=9
MATCHING_REPLIES_FOUND=0
```

Regras de interpretação:

- as contagens confirmam atividade manual na conta operacional;
- não comprovam que o runtime preparou, reservou, enviou ou registrou essas mensagens;
- não autorizam novos envios;
- destinatários, assuntos completos e conteúdo não devem ser copiados para issues, PRs, logs ou documentação;
- bounce, opt-out, complaint e contato inválido devem ser reconciliados antes de nova preparação.

## Segurança

### Estado hospedado observado

Na última auditoria autenticada:

- `57` tabelas públicas;
- RLS habilitado nas `57`;
- `11` policies observadas para `lead_finder_api_runtime`;
- zero grants de tabela observados para `PUBLIC`, `anon` ou `authenticated`;
- Data API pública sem acesso de tabela para essas roles.

A afirmação anterior de “zero policies” está desatualizada. O desenho atual combina deny-all público com policies estreitas para a role interna.

### Código e CI

Foram observados:

- defaults fail-closed;
- idempotência antes de efeitos externos;
- histórico append-only;
- locks transacionais;
- grants de privilégio mínimo;
- testes de RLS, migration registry, PII contracts, restore e integração;
- sanitização de logs e fingerprints;
- ausência de evidência de secret real versionado na busca direcionada.

Essas evidências não equivalem a uma auditoria completa de todos os logs hospedados.

### Performance

A consulta de catálogo encontrou `28` foreign keys potencialmente sem índice líder. Elas devem ser revisadas com carga e planos de execução antes de escala. O finding é dívida técnica e não bloqueia isoladamente um piloto pequeno.

## Matriz de capacidades

| Capacidade | Código | HML | Main | Hospedado | Autorizado |
|---|---|---|---|---|---|
| Descoberta/qualificação | `IMPLEMENTED` | `IN_HML` | `IN_MAIN` | `DEPLOYED` | `DISABLED` |
| CRM/revisão | `IMPLEMENTED` | `IN_HML` | `IN_MAIN` | `DEPLOYED` | `BLOCKED` |
| E-mail manual — template/preparação | `IMPLEMENTED` | `IN_HML` | `NOT_VERIFIED` | `NOT_VERIFIED` | `BLOCKED` |
| Consumidor Gmail restrito | `IMPLEMENTED` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `BLOCKED` |
| Supressão de bounce/contato inválido | `IMPLEMENTED` | `IN_HML` | `NOT_IMPLEMENTED` | `NOT_VERIFIED` | `BLOCKED` |
| WhatsApp Cloud API HML | `IMPLEMENTED` | `IN_HML` | `NOT_VERIFIED` | `DEPLOYED` | `DISABLED` |
| Produção automática | `DISABLED` | `DISABLED` | `DISABLED` | `DISABLED` | `DISABLED` |

`IMPLEMENTED` pode significar código presente em PR aberta. `IN_HML` exige integração na branch de homologação. `DEPLOYED` exige evidência do ambiente hospedado no SHA correspondente.

## Gates para o primeiro piloto real repetível

1. reconciliar os envios manuais e as notificações de falha;
2. revalidar e aplicar a migration `0041` somente mediante autorização separada, backup e preflight;
3. registrar as supressões definitivas e provar o bloqueio nos gates de elegibilidade;
4. atualizar a PR #215 sobre a HML atual;
5. corrigir a CI e a contradição Draft/Ready da PR #215;
6. reconciliar os dois registries de migration;
7. aplicar a migration `0042` somente após CI verde, backup, preflight e autorização separada;
8. comprovar consumidor Gmail restrito, idempotente e fail-closed;
9. executar lote pequeno com aprovação humana individual;
10. registrar resultados agregados e emitir GO/NO-GO separado.

## Restrições invariáveis

Continuam proibidos sem autorização específica:

- deploy ou restart;
- migrations hospedadas;
- alteração de roles, secrets ou variáveis;
- coleta externa;
- provider real;
- follow-up automático;
- retry após falha ambígua;
- WhatsApp Web automatizado;
- produção comercial automática;
- publicação de PII ou secrets.