# Variáveis de ambiente

Este documento separa variáveis ativas no runtime atual de placeholders reservados para integrações futuras. Valores secretos nunca possuem fallback seguro e não devem aparecer em Git, issues, logs, URLs ou artifacts.

## Perfis

- **A — `oracle-vps`:** API, worker e PostgreSQL em Docker Compose; Caddy e n8n opcionais.
- **B — `supabase-render`:** API no Render, PostgreSQL no Supabase e invocação de batch opcional.

## Runtime e autenticação

| Variável | A | B | Visibilidade | Regra |
|---|---:|---:|---|---|
| `NODE_ENV` | sim | sim | pública | específica do ambiente |
| `DEPLOYMENT_PROFILE` | sim | sim | pública | `oracle-vps` ou `supabase-render` |
| `API_PORT` / `PORT` | sim | sim | pública | porta do processo |
| `LOG_LEVEL` | sim | sim | pública | sem payloads sensíveis |
| `API_AUTH_TOKEN` | sim | sim | secret | obrigatório; mínimo de 32 caracteres |
| `API_AUTH_PERMISSIONS` | sim | sim | configuração | allowlist CSV estrita; sem wildcard |
| `PUBLIC_API_URL` | sim | sim | pública | URL do ambiente; não contém segredo |
| `CORS_ALLOWED_ORIGINS` | sim | sim | pública | allowlist explícita |

## PostgreSQL e Supabase

| Variável | A | B | Visibilidade | Regra |
|---|---:|---:|---|---|
| `DATABASE_URL` | sim | sim | secret | obrigatória; somente server-side |
| `DIRECT_DATABASE_URL` | opcional | migrations/backup | secret | conexão direta para operação controlada |
| `DATABASE_SSL_MODE` | opcional | sim | pública | B exige `require` |
| `DATABASE_POOL_MAX` | sim | sim | pública | padrão `10`; B inicia com `3` |
| `POSTGRES_DB` | sim | não | configuração | banco do Compose |
| `POSTGRES_USER` | sim | não | configuração | usuário do Compose |
| `POSTGRES_PASSWORD` | sim | não | secret | sem valor padrão real |
| `SUPABASE_PROJECT_REF` | não | operador | secret operacional | nunca frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | não | operador | secret | não usada pelo runtime comum; nunca frontend |
| `SUPABASE_URL` | não | reservado | pública | Data API não é usada atualmente |
| `SUPABASE_ANON_KEY` | não | reservado | pública com baixo privilégio | manter vazia enquanto a Data API permanecer deny-all |

A aplicação usa PostgreSQL direto por `DATABASE_URL`. Qualquer uso futuro de `SUPABASE_URL`, `SUPABASE_ANON_KEY`, cliente móvel ou `/rest/v1` exige threat model, policies RLS e testes negativos conforme [Segurança da Data API Supabase](../supabase-data-api-security.md).

## Coleta, batch e processadores

| Variável | A | B | Regra |
|---|---:|---:|---|
| `COLLECTION_EGRESS_ENABLED` | sim | sim | `false` por padrão |
| `OVERPASS_API_URL` | opcional | opcional | vazio enquanto egress estiver desligado |
| `ENRICHMENT_EGRESS_ENABLED` | sim | sim | `false` por padrão; independente da coleta |
| `ENRICHMENT_API_URL` | opcional | opcional | vazio enquanto enriquecimento estiver desligado |
| `ENRICHMENT_MIN_INTERVAL_MS` | sim (worker) | sim (worker) | 250 ms por padrão; limita a cadência do provider de enriquecimento |
| `OVERPASS_TIMEOUT_MS` | sim | sim | timeout limitado |
| `OVERPASS_MAX_RETRIES` | sim | sim | retry limitado |
| `DAILY_LEAD_LIMIT` | sim | sim | `60`, teto de banco 60 |
| `LEAD_BATCH_SIZE` | sim | sim | `5`, máximo 10 |
| `PROCESSING_TIME_BUDGET_MS` | sim | sim | `45000`, máximo 50000 |
| `WORKER_POLL_INTERVAL_MS` | sim | não | padrão `60000` |
| `PROCESSOR_ROLE` | sim | sim | `standby` salvo executor ativo |
| `PROCESSOR_LEASE_MS` | sim | sim | liderança persistida no banco |
| `INTERNAL_CRON_SECRET` | não | opcional | secret dedicado à invocação interna |
| `CRON_AUTH_AUDIENCE` | não | opcional | padrão `lead-finder-batch` |

`supabase-render` recusa switches inseguros no startup. Cron e Edge Function não são habilitados apenas pela existência dos descritores no repositório.

## Gates de segurança

| Variável | Default genérico | Homologação segura | Regra |
|---|---:|---:|---|
| `DRY_RUN` | `true` | `true` | efeitos externos bloqueados |
| `SHADOW_MODE_ENABLED` | `false` | `true` | ativo somente em ambiente isolado validado |
| `PILOT_KILL_SWITCH_ENABLED` | `false` | testado e engatado em incidente | não inicia serviços automaticamente ao liberar |
| `REAL_SEND_ENABLED` | `false` | `false` | envio real proibido |
| `REAL_PROVIDERS_ENABLED` | `false` | `false` | providers externos proibidos |
| `REAL_PROVIDER_CONFIGURED` | `false` | `false` | só muda após sandbox e aprovação |

Nenhuma combinação parcial pode liberar envio. O runtime real futuro deve exigir todos os gates simultaneamente, além de elegibilidade, revisão humana, idempotência, limites e opt-out íntegro.

## WhatsApp Cloud API HML sandbox

A integração Cloud API é restrita a HML, ao principal de operador e a um único
escopo de reserva. Mantenha `WHATSAPP_CLOUD_API_ENABLED=false` e
`REAL_SEND_ENABLED=false` por padrão. Quando um sandbox HML for aprovado
separadamente, configure no gerenciador de segredos o Phone Number ID, WABA ID,
token, destinatário controlado, versão da API e `WHATSAPP_CLOUD_MAX_SENDS=1` em
conjunto. Nunca versione esses valores nem os exponha em logs; configuração
parcial e qualquer ambiente diferente de homologação são rejeitados.

## WhatsApp e IA — reservadas, ainda não ativas

Estas variáveis estão previstas na arquitetura, mas não representam integração implementada:

```text
WHATSAPP_PROVIDER=disabled
WHATSAPP_GRAPH_API_VERSION=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR

AI_PROVIDER=disabled
OPENAI_API_KEY=
OPENAI_MODEL=
AI_REQUEST_TIMEOUT_MS=15000
AI_DAILY_BUDGET_CENTS=0
```

Regras:

- secrets somente no gerenciador do ambiente;
- nenhuma chave no cliente, GitHub Pages ou bundle estático;
- `WHATSAPP_PROVIDER` e `AI_PROVIDER` permanecem `disabled` até PR específica;
- chave OpenAI deve ser server-side, com orçamento e rotação;
- `store=false`, minimização de PII e saída estruturada são gates da integração;
- token Meta, App Secret e verify token nunca são intercambiáveis;
- a existência de credencial não autoriza provider nem envio.

Referências:

- [Arquitetura WhatsApp + IA](../whatsapp-ai-messaging-architecture.md)
- [Checklist de implementação](../whatsapp-ai-implementation-checklist.md)
- [Issue #79 — onboarding de providers](https://github.com/brunoferreirasalustiano/lead-finder-sem-site/issues/79)
