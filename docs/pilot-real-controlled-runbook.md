# Primeiro ciclo real controlado — homologação fail-closed

Antes de restore, pare API/worker, confirme ausência de processamento e exporte/valide o manifesto conforme `infrastructure/backup-and-restore.md`. Após restore e migrations, execute dry-run, aplicação explícita, verificação em nova conexão e preflight. Nenhum serviço inicia automaticamente; qualquer falha mantém `RESTORE_SUPPRESSION_BLOCKED`.

Este runbook prepara a homologação do primeiro piloto da issue #33. Ele não autoriza contato, coleta, scraping, envio, provider, webhook, SDK de mensageria, WhatsApp Web, n8n, deploy produtivo ou uso de dados reais.

## Limites e pré-requisitos

- Use uma VM/VPS controlada ou Docker local, nunca a stack de produção.
- A configuração local é `.env.homologation`, criada a partir de `.env.homologation.example` e mantida fora do Git.
- O único banco aceito é `leadfinder_homologation`; o restore é sempre em `leadfinder_homologation_restore`.
- Gere token e senha locais exclusivamente para a homologação. Não copie valores de produção.
- O perfil `n8n` permanece `disabled`; não use `--profile disabled`.

O override `docker-compose.homologation.yml` fixa `SHADOW_MODE_ENABLED=true` e todas as capacidades externas em `false`. As configurações de desenvolvimento e produção mantêm shadow como `false` por padrão.

## Inicialização controlada

```bash
cp .env.homologation.example .env.homologation
chmod 600 .env.homologation
# Preencha somente segredos novos e locais; mantenha todos os flags externos em false.
npm run pilot:real:preflight -- --env-file .env.homologation
docker compose --env-file .env.homologation -f docker-compose.yml -f docker-compose.homologation.yml up -d postgres
docker compose --env-file .env.homologation -f docker-compose.yml -f docker-compose.homologation.yml run --rm migrate
docker compose --env-file .env.homologation -f docker-compose.yml -f docker-compose.homologation.yml up -d api worker
```

O preflight deve continuar em `PILOT_REAL_NOT_READY` enquanto não houver evidência operacional independente. Isso é esperado antes do ciclo controlado.

## Lote sintético e logs

```bash
npm run pilot:real:fixture
npm run pilot:real:log-privacy -- --file ./logs-operacionais-sinteticos.log --output .pilot-evidence/log-privacy.json
npm run pilot:real:preflight -- --env-file .env.homologation --log-report .pilot-evidence/log-privacy.json
```

O lote tem exatamente 20 empresas e contatos fictícios. Ele testa bloqueio, opt-out, `NAO_CONTATAR`, duplicidade exata/normalizada, região, categoria, contato, presença de site, origem, idempotência e métricas; `externalEffects` deve ser zero. O relatório de logs só expõe tipo e contagem de achados, nunca o conteúdo detectado.

## Backup, restore e rollback

Primeiro execute o dry-run. A execução faz dump da homologação e restaura somente no banco separado; ela nunca restaura sobre `leadfinder_homologation`.

```bash
PILOT_HOMOLOGATION_ENV_FILE=.env.homologation scripts/pilot-homologation-backup-restore.sh --dry-run
PILOT_HOMOLOGATION_ENV_FILE=.env.homologation \
  PILOT_BACKUP_RESTORE_CONFIRMATION=RESTORE_SYNTHETIC_HOMOLOGATION \
  scripts/pilot-homologation-backup-restore.sh --execute
```

O script compara quantidade de migrations e tabelas do banco fonte e do banco restaurado e salva `.pilot-evidence/backup-restore.json`. Falha de qualquer etapa grava `FAIL`; indisponibilidade de Docker/PostgreSQL deve ser registrada como `BLOCKED` no relatório operacional, nunca convertida em `PASS`.

Rollback é propositalmente não destrutivo: congela a operação, persiste o kill switch e não faz restore in-place. A restauração de um snapshot no banco de origem exige decisão humana independente, após a verificação no banco separado e reconciliação de opt-outs/bloqueios posteriores ao backup.

```bash
PILOT_HOMOLOGATION_ENV_FILE=.env.homologation scripts/pilot-homologation-rollback.sh --dry-run
PILOT_HOMOLOGATION_ENV_FILE=.env.homologation \
  PILOT_ROLLBACK_CONFIRMATION=PREPARE_HOMOLOGATION_ROLLBACK \
  scripts/pilot-homologation-rollback.sh --prepare
```

## Kill switch e incidente

Para interromper imediatamente, o comando exige confirmação explícita, coloca `PILOT_KILL_SWITCH_ENABLED=true` no arquivo de homologação, para API e worker e preserva a evidência. O worker também bloqueia antes de claim, autorização ou adapter caso seja iniciado enquanto o switch está ligado.

```bash
PILOT_HOMOLOGATION_ENV_FILE=.env.homologation scripts/pilot-homologation-kill-switch.sh --dry-run
PILOT_HOMOLOGATION_ENV_FILE=.env.homologation \
  PILOT_KILL_SWITCH_CONFIRMATION=ENGAGE_HOMOLOGATION_PILOT \
  scripts/pilot-homologation-kill-switch.sh engage
```

Durante um incidente: mantenha os serviços parados, não reenvie nada, mantenha `COLLECTION_EGRESS_ENABLED=false`, `REAL_PROVIDER_CONFIGURED=false` e todos os flags externos em `false`; preserve os artefatos `.pilot-evidence` e os dumps com permissão restrita. Revogue/troque o token editando apenas `.env.homologation`, sem registrar o valor em terminal, ticket ou log. Para liberar o switch, use `release` com confirmação; o comando não inicia serviços automaticamente. Reexecute todo o preflight antes de retomar.

## Mensagem manual e fechamento

Use somente [o template versionado](pilot-real-manual-message-v1.md) após revisão humana preenchida fora do repositório. A aprovação precisa registrar segmento, região, canal, responsável, versão, data, texto e critérios de suspensão. Uma resposta negativa, opt-out, bloqueio, dado inconsistente ou qualquer incidente suspende o contato; não há segundo contato após opt-out.

Encerramento seguro:

```bash
docker compose --env-file .env.homologation -f docker-compose.yml -f docker-compose.homologation.yml stop api worker
npm run pilot:real:preflight -- --env-file .env.homologation --output .pilot-evidence/preflight.json
```

O comando imprime as dez gates com apenas `PASS`, `FAIL`, `NOT RUN` ou `BLOCKED`. Só emite `PILOT_REAL_READY` se todas estiverem em `PASS`; em qualquer outro caso, emite `PILOT_REAL_NOT_READY` e as próximas ações.
