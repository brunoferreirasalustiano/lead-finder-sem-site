# Principal temporário de leitura das métricas em HML

Este principal existe somente para verificar, de forma autenticada e com prazo curto, o contrato de `GET /internal/prospecting/city-metrics` em homologação.

## Escopo fixo

A permissão é definida no código e não pode ser ampliada por variável de ambiente:

```text
prospecting:metrics:read
```

O principal não possui permissões de campanhas, coleta, leads, CRM, piloto, mensagens, e-mail, WhatsApp, operações ou providers.

## Configuração fail-closed

O principal permanece desativado por padrão. Quando habilitado, todos os campos abaixo são obrigatórios:

```text
HML_METRICS_AUTH_ENABLED=true
HML_METRICS_AUTH_TOKEN_HASH=<SHA-256 hexadecimal do token temporário>
HML_METRICS_AUTH_EXPIRES_AT=<timestamp ISO-8601 futuro com offset>
HML_METRICS_AUTH_PRINCIPAL_ID=hml-metrics-<identificador>
```

Regras obrigatórias:

- somente `DEPLOYMENT_ENVIRONMENT=homologation`;
- expiração futura de no máximo uma hora;
- hash diferente dos tokens principal, smoke e operador;
- identificador diferente dos outros principais temporários;
- campos parciais com o gate desligado bloqueiam a inicialização;
- token vencido é recusado;
- tentativas inválidas compartilham o limitador dos principais temporários.

## Relação com a feature flag

Autenticação e ativação das métricas são gates independentes. Com o principal válido e:

```text
PROSPECTING_METRICS_ENABLED=false
```

a rota deve retornar:

```text
HTTP 503
PROSPECTING_METRICS_DISABLED
```

Nesse estado, a consulta ao banco não é executada. A criação deste principal não autoriza habilitar a feature flag.

## Verificação controlada

A ordem segura é:

1. implantar o código com o principal desativado e a feature flag em `false`;
2. confirmar `/health/ready` com HTTP 200;
3. gerar um token temporário fora do repositório e armazenar no Render somente o hash;
4. habilitar o principal com expiração de até uma hora;
5. executar uma única consulta autenticada e esperar HTTP 503 enquanto a flag estiver desligada;
6. confirmar que o mesmo token recebe HTTP 403 em uma rota fora da permissão;
7. desabilitar o principal e remover hash, expiração e identificador;
8. manter `PROSPECTING_METRICS_ENABLED=false`.

Nenhum token completo, hash operacional, payload de resposta ou segredo deve ser versionado.
