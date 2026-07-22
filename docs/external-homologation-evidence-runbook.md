# Runbook de evidências da homologação externa

## Objetivo

Definir provas mínimas, reproduzíveis e sanitizadas para liberar a homologação do primeiro lote manual. Este runbook não autoriza deploy, provider ou envio real.

## Princípio

Nenhum gate externo é considerado concluído por inferência. Configuração no repositório, CI verde e existência de uma URL são evidências diferentes. O gate exige prova do recurso efetivamente servido ou executado.

## Níveis de evidência

| Nível | Exemplo | Valor operacional |
|---|---|---|
| `DECLARED` | YAML, documentação ou variável esperada | intenção; não comprova execução |
| `BUILT` | CI e artefato gerado | comprova construção, não publicação |
| `DEPLOYED` | plataforma registra deploy do SHA correto | comprova implantação |
| `SERVED` | endpoint público responde com conteúdo esperado | comprova disponibilidade |
| `OPERABLE` | health, flags e kill switch testados | comprova prontidão controlada |

Somente `OPERABLE` libera o gate de homologação da aplicação.

## GitHub Pages — aviso de privacidade

### Evidências obrigatórias

- [ ] commit da `main` contém `privacidade/index.html` ou fonte equivalente;
- [ ] workflow de Pages valida o arquivo no artefato;
- [ ] run de `push` para `main` concluído com sucesso;
- [ ] job de deploy concluído;
- [ ] URL pública retorna HTTP 200;
- [ ] conteúdo público contém finalidade, origem, opt-out, direitos e e-mail oficial;
- [ ] canonical aponta para a rota pública correta;
- [ ] links internos para privacidade funcionam;
- [ ] página não contém formulário, pixel, analytics ou coleta própria;
- [ ] evidência registrada sem screenshot com dados pessoais.

### Verificação manual reproduzível

Executar em ambiente com acesso de rede:

```bash
curl --fail --silent --show-error \
  --location \
  --output /tmp/lead-finder-privacy.html \
  https://brunoferreirasalustiano.github.io/lead-finder-demos/privacidade/

grep -Fq 'Lead Finder Brasil' /tmp/lead-finder-privacy.html
grep -Fq 'leadfinderbrasil@gmail.com' /tmp/lead-finder-privacy.html
grep -Eiq 'opt-out|não receber|interrupção' /tmp/lead-finder-privacy.html
grep -Eiq 'direitos|acesso|correção|exclusão' /tmp/lead-finder-privacy.html
```

Não anexar o HTML completo a issue pública. Registrar somente SHA, horário, HTTP status e lista de asserts aprovados.

## Render — serviço de homologação

### Identidade do serviço

Registrar de forma sanitizada:

- workspace;
- nome do serviço;
- service ID;
- região;
- branch ou source commit;
- último deploy SHA;
- tipo de serviço;
- domínio público;
- política de auto-deploy.

Não registrar token, connection string, secret ou valor integral de variável sensível.

### Health checks

Verificar:

```bash
curl --fail --silent --show-error --location \
  https://<HOST_HML>/health/live

curl --fail --silent --show-error --location \
  https://<HOST_HML>/health/ready
```

Critérios:

- `/health/live`: HTTP 200 e processo ativo;
- `/health/ready`: HTTP 200, banco acessível, migrations compatíveis e nenhuma dependência crítica degradada;
- resposta não expõe segredo, URL de banco ou PII;
- timeout e erro são tratados como bloqueio.

### Flags fail-closed

Comprovar, por metadado da plataforma ou endpoint interno autenticado e sanitizado:

| Flag | Valor obrigatório |
|---|---|
| `DRY_RUN` | `true` |
| `SHADOW_MODE_ENABLED` | `true` |
| `REAL_SEND_ENABLED` | `false` |
| `REAL_PROVIDERS_ENABLED` | `false` |
| `REAL_PROVIDER_CONFIGURED` | `false` |
| `COLLECTION_EGRESS_ENABLED` | `false` |

A ausência da flag deve ser interpretada conforme o default seguro do código. Se o default não puder ser comprovado, o gate falha fechado.

### Kill switch

1. Capturar estado sanitizado antes do teste.
2. Acionar o mecanismo de bloqueio sem mensagem real.
3. Tentar operação sintética.
4. Exigir bloqueio antes de outbox/provider.
5. Restaurar somente o estado de homologação.
6. Repetir health/readiness.
7. Confirmar zero efeito externo.

## Restart lógico

- registrar SHA implantado;
- reiniciar o serviço pela plataforma;
- confirmar `/health/live` e `/health/ready` após o restart;
- executar replay sintético idempotente;
- confirmar estado persistido;
- confirmar zero provider e zero egress.

## Logs

Amostra permitida:

- timestamp;
- nível;
- evento allowlisted;
- IDs opacos;
- resultado do gate;
- duração.

Proibido:

- telefone;
- e-mail;
- mensagem;
- URL completa de contato;
- token;
- connection string;
- payload bruto.

## Falhas do conector

Quando o conector retornar ferramentas de outro aplicativo, schema incompatível ou resultado impossível de atribuir ao Render:

1. não executar escrita;
2. registrar o erro de descoberta;
3. não afirmar que o serviço inexiste;
4. usar leitura alternativa autenticada somente quando disponível;
5. manter o gate como `BLOCKED_BY_CONNECTOR`.

## Critério de saída

Todas as provas devem apontar para o mesmo SHA de homologação.

Veredito:

`EXTERNAL_HOMOLOGATION_PROVED`
