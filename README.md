# Lead Finder Brasil

CRM de prospecção em evolução para uma plataforma brasileira de inteligência comercial, descoberta ativa, qualificação assistida por IA e encaminhamento humano de oportunidades.

A busca de empresas com indícios de ausência de site e a oferta de landing pages constituem a primeira vertical experimental do produto. A visão futura inclui múltiplos nichos, cobertura nacional e prospecção conversacional governada.

> **Estado atual:** homologação fail-closed, dados sintéticos, coleta externa desligada e nenhum envio real por e-mail, WhatsApp ou IA.

- [Estado operacional consolidado](docs/current-operational-status.md)
- [Escopo futuro do produto](docs/FUTURE_PRODUCT_SCOPE.md)
- [Índice de documentação](docs/README.md)
- [Auditoria de segurança e privacidade](docs/security-privacy-audit.md)
- [Threat model operacional](docs/operational-threat-model.md)
- [Roadmap estratégico](docs/PRODUCT_ROADMAP.md)

## Regra fundamental

`SEM_SITE_CADASTRADO` significa apenas que a fonte consultada não informou um site. Isso **não comprova** que a empresa não possui site.

Nenhuma abordagem comercial pode ocorrer antes de:

1. validar a empresa e o indício de ausência de site;
2. validar o contato e sua origem;
3. confirmar ausência de bloqueio, `NAO_CONTATAR` e opt-out aplicável;
4. registrar revisão humana;
5. usar template aprovado;
6. reservar idempotência e limites;
7. confirmar que todos os efeitos externos permitidos estão explicitamente habilitados.

Qualquer dúvida resulta em `REVISAO_HUMANA` e impede a ação.

## Estado do projeto

### Implementado

- descoberta por OpenStreetMap/Overpass, com egress desligado por padrão;
- normalização, scoring e deduplicação;
- qualificação conservadora e evidências;
- contatos versionados e associados ao lead;
- CRM, oportunidades, tarefas, notas, tags e timeline;
- campanhas e templates versionados;
- seleção elegível e revisão humana;
- destinatários, tentativas, eventos e outbox transacionais;
- leasing, concorrência e liderança de processadores;
- limites diários, janela de execução e espaçamento;
- retry limitado, dead-letter e recuperação auditável;
- pausa, cancelamento, opt-out e bloqueios antes da execução;
- piloto interno com revisão, contato manual e resultados;
- gate sintético determinístico em PostgreSQL;
- autenticação Bearer e matriz explícita de permissões;
- logs e evidências sanitizados;
- Docker Compose, imagens API/worker, smoke e CI com PostgreSQL;
- perfis `oracle-vps` e `supabase-render`;
- Supabase Data API em postura deny-all;
- runbooks do piloto manual, WhatsApp, IA, backup, restore e failover.

### Pendente ou bloqueado

- confirmação externa automatizada de ausência real de site;
- enriquecimento externo de contatos;
- adaptador oficial de Google Places;
- cobertura nacional ampliada;
- adaptador oficial de e-mail;
- WhatsApp Business Cloud API;
- webhooks externos assinados;
- OpenAI em shadow mode;
- sandbox Meta e OpenAI — [issue #79](https://github.com/brunoferreirasalustiano/lead-finder-sem-site/issues/79);
- propostas comerciais e PDF;
- dashboard operacional e comercial;
- automações completas no n8n;
- piloto com leads reais;
- validação do perfil Oracle em VPS real;
- evolução gradual até a meta futura de 60 mensagens efetivamente enviadas por dia.

## Arquitetura

```text
Descoberta -> Normalização -> Deduplicação -> Validação -> Qualificação
-> CRM -> Revisão humana -> Campanha -> Outbox simulada
-> Resultado manual/simulado -> Métricas -> Proposta futura
```

Componentes principais:

- `apps/api` — API Fastify, autenticação, autorização e rotas operacionais;
- `apps/worker` — processamento de jobs e outbox simulada;
- `packages/database` — schema, repositórios, migrations, idempotência e filas;
- `packages/batch-processor` — processamento limitado e coordenado;
- `packages/overpass-client` — consultas seguras, timeout e retry;
- `packages/lead-scoring` — regras puras de pontuação;
- `packages/shared` — contratos e schemas Zod;
- `database/migrations` — SQL incremental e versionado;
- `deploy` — descritores Oracle, Supabase e Caddy;
- `scripts` — migrations, gates, backup, restore, rollback e smoke;
- `n8n/workflows` — automações opcionais, ainda não operacionais.

## Perfis de implantação

### Supabase + Render

Perfil de homologação e Plano B:

- API Node.js no Render;
- PostgreSQL no Supabase;
- conexão server-side por `DATABASE_URL`;
- TLS obrigatório;
- pool inicial reduzido;
- Edge Function e Cron opcionais e desligados por padrão;
- dry-run e providers externos bloqueados.

Documentos:

- [Plano B Supabase + Render](docs/infrastructure/supabase-render-plan-b.md)
- [Runbook de implantação](docs/runbooks/supabase-render-deployment.md)
- [Operação com dois perfis](docs/runbooks/dual-deployment-operations.md)
- [Segurança da Data API](docs/supabase-data-api-security.md)

### Oracle VPS

Perfil self-hosted completo:

- Ubuntu;
- Docker Compose;
- PostgreSQL, API e worker em redes privadas;
- Caddy em 80/443;
- n8n opcional;
- backup, restore, rollback e observabilidade locais.

A validação em VPS real continua pendente.

Documento: [Runbook Oracle](docs/ORACLE_DEPLOY.md).

## Defaults de segurança

```text
COLLECTION_EGRESS_ENABLED=false
DRY_RUN=true
REAL_SEND_ENABLED=false
REAL_PROVIDERS_ENABLED=false
REAL_PROVIDER_CONFIGURED=false
```

A homologação isolada usa `SHADOW_MODE_ENABLED=true`. O kill switch deve ser testado antes do piloto e engatado durante incidentes.

Nenhuma credencial ou configuração parcial autoriza envio. A execução real futura exigirá todos os gates simultaneamente.

## Supabase deny-all

O backend usa conexão PostgreSQL direta. A Data API pública não é usada.

Estado verificado:

- 39 tabelas públicas com RLS;
- zero policies;
- zero grants para `PUBLIC`, `anon` e `authenticated`;
- zero execução pública de funções;
- `CREATE` no schema público revogado;
- nenhum `supabase-js` ou `/rest/v1` no runtime.

Não criar policies permissivas apenas para eliminar o aviso informativo `RLS Enabled No Policy`.

Detalhes: [Segurança da Data API Supabase](docs/supabase-data-api-security.md).

## Piloto manual controlado

O piloto documentado não é disparo automatizado.

Regras do primeiro lote:

- no máximo cinco negócios;
- uma categoria;
- uma cidade ou região;
- seleção individual;
- revisão humana obrigatória;
- primeiro contato sem link, salvo autorização do destinatário;
- opt-out imediato;
- nenhum follow-up automático;
- nenhum WhatsApp Web automatizado;
- nenhuma lista comprada ou importação em massa;
- nenhuma métrica inferida pela abertura de link.

O recorte regional pertence ao primeiro piloto. A visão comercial futura da vertical de landing pages é nacional, com aumento progressivo de capacidade até 60 mensagens efetivamente enviadas por dia somente após validação dos gates e dos indicadores de qualidade.

Documentos:

- [Pacote operacional](docs/pilot-manual-operations-pack.md)
- [Template manual v1](docs/pilot-real-manual-message-v1.md)
- [Runbook do ciclo controlado](docs/pilot-real-controlled-runbook.md)
- [Matriz de prontidão](docs/commercial-readiness-matrix.md)

### Teste interno do canal de e-mail

O endpoint `POST /operator-tests/email/send` existe somente para verificar o
canal do próprio operador. Ele aceita exclusivamente o template imutável
`operator-email-channel-test` v1 e exige que remetente, usuário SMTP e
destinatário sejam a mesma caixa interna autorizada.

O recurso inicia desligado e com kill switch ativo. As credenciais e a chave de
fingerprint são segredos externos ao repositório. O teste registra apenas
fingerprints e estado append-only; não persiste endereço, corpo, assunto ou
identificador do provedor. Esse endpoint não habilita envio para leads e não
altera `REAL_SEND_ENABLED=false` nem `REAL_PROVIDERS_ENABLED=false`.

## WhatsApp e IA

Estado: arquitetura e controles documentados; integração real ausente.

Princípios:

- WhatsApp somente pela Cloud API oficial;
- WhatsApp Web, QR Code, Baileys, Evolution API e equivalentes são proibidos;
- IA gera rascunho ou classificação, nunca autoriza envio;
- saída inválida ou incerta retorna `REVISAO_HUMANA`;
- prompts minimizam PII;
- OpenAI deverá usar chave server-side, Structured Outputs e `store=false`;
- webhooks deverão validar assinatura sobre os bytes originais;
- sandbox usará somente números próprios em allowlist;
- tokens e payloads integrais nunca entram em logs ou Git.

Documentos:

- [Arquitetura WhatsApp + IA](docs/whatsapp-ai-messaging-architecture.md)
- [Checklist de implementação](docs/whatsapp-ai-implementation-checklist.md)
- [Registro de riscos](docs/whatsapp-ai-risk-register.md)

## Requisitos locais

- Node.js 22 ou superior;
- npm;
- Docker Engine e Docker Compose para integração local completa;
- PostgreSQL real executado pelo Compose ou CI.

O usuário atual trabalha em Windows sem Docker Desktop/WSL; por isso, integrações PostgreSQL, Compose e multiarch podem ser executadas na CI ou por ferramenta apropriada em ambiente compatível.

## Configuração local

```bash
cp .env.example .env
npm install
```

Preencha apenas valores locais. Nunca copie secrets de homologação ou produção.

Para a stack local:

```bash
docker compose up -d postgres
docker compose run --rm migrate
npm run dev:api
npm run dev:worker
```

Stack completa:

```bash
docker compose up --build
```

As migrations usam `schema_migrations` e devem ser reaplicáveis sem executar alteração duplicada.

Variáveis: [documentação de ambiente](docs/infrastructure/environment-variables.md).

## API e autorização

Rotas públicas:

- `GET /health/live`
- `GET /health`
- `GET /health/ready`

As demais rotas exigem:

```text
Authorization: Bearer <API_AUTH_TOKEN>
```

`API_AUTH_TOKEN` precisa ter pelo menos 32 caracteres. `API_AUTH_PERMISSIONS` usa allowlist CSV estrita, sem wildcards ou valores desconhecidos.

Grupos de rotas:

- leads, qualificação, evidências e contatos;
- CRM, oportunidades, notas, tags, tarefas e timeline;
- campanhas, versões, revisão e simulação;
- recipients, attempts, failures e audit;
- piloto interno, revisão, contato manual e resultados;
- batch interno autenticado;
- coleta externa bloqueada por feature flag.

A API permanece single-operator. Multi-tenant exige OIDC, isolamento por tenant e autorização por objeto antes de atender clientes externos.

## Qualidade e CI

Comandos principais:

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run test:integration
npm run test:pilot
npm run test:pilot:restart
npm audit --audit-level=high
docker compose config
```

Gates:

| Gate | Verificação |
|---|---|
| G0 | escopo, regras de negócio e risco |
| G1 | typecheck, lint e build |
| G2 | testes unitários e cobertura |
| G3 | integração PostgreSQL |
| G4 | smoke, deploy e rollback aplicáveis |
| G5 | AMD64/ARM64 quando houver imagem |
| G6 | validação no commit exato da `main` |
| G7 | infraestrutura real |
| G8 | segurança comercial, opt-out e idempotência |

Nenhum gate pode ser ocultado com `continue-on-error` apenas para deixar a pipeline verde. Falha de infraestrutura deve ser `BLOCKED`, não `PASS`.

## Política de execução autônoma

O trabalho pode avançar automaticamente quando:

- estiver no roadmap aprovado;
- não exigir credencial, pagamento ou confirmação humana externa;
- houver critério objetivo de teste;
- a mudança for reversível;
- não houver risco de contato real não autorizado.

Processo:

1. criar branch específica;
2. implementar escopo mínimo;
3. executar validações;
4. abrir PR com riscos e evidências;
5. corrigir findings;
6. integrar por squash;
7. verificar a `main`;
8. atualizar documentação e issue.

### Seleção do modelo Codex

- **Luna:** documentação, investigação simples e mudanças locais de baixo risco;
- **Terra:** implementação padrão, testes e refatorações moderadas;
- **Sol:** segurança, migrations, restore, concorrência, autenticação, infraestrutura e mudanças de alto impacto.

O modelo deve ser informado antes de cada trabalho do Codex, com justificativa de risco, complexidade e custo.

## Segurança operacional

- nenhum secret no Git;
- PostgreSQL sem exposição pública desnecessária;
- logs sem PII e payload bruto;
- autenticação e autorização no aplicativo;
- opt-out global e por canal;
- `NAO_CONTATAR` com reativação explícita e auditada;
- idempotência antes de efeitos externos;
- retry somente para falhas transitórias classificadas;
- provider real desligado por padrão;
- backup e restore com reconciliação de supressões;
- nenhuma automação de navegador para WhatsApp;
- nenhuma dependência de navegador aberto para operação 24/7.

## Limitações atuais

- dados OSM podem estar incompletos ou desatualizados;
- ausência de site na fonte não confirma ausência real;
- não existe envio real pelo runtime;
- não existe provider Meta, e-mail, Google Places ou OpenAI integrado;
- não existe dashboard ou proposta em PDF;
- não existe homologação Oracle real;
- cron e Edge Function do Plano B não estão ativos por padrão;
- o projeto não está pronto para multi-tenant, prospecção nacional automática ou escala de 60 mensagens diárias.

Dados do OpenStreetMap estão sujeitos à ODbL e exigem atribuição apropriada.

## Manutenção documental

Toda PR que alterar arquitetura, flags, ambiente, provider, segurança ou estado de uma fase deve revisar:

1. [estado operacional consolidado](docs/current-operational-status.md);
2. este `README.md`;
3. [índice de documentação](docs/README.md);
4. runbook e registro de riscos afetados;
5. issue e evidências de CI correspondentes.

Nunca documentar publicamente tokens, senhas, connection strings, PII de leads, mensagens integrais ou payloads brutos.
