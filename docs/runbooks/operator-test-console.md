# Console auditada do `OPERATOR_TEST`

## Objetivo

Executar um único teste fechado de WhatsApp com destino pertencente ao operador, usando a API autenticada do Lead Finder Brasil para registrar preparação e eventos, sem provider, webhook, automação do WhatsApp Web ou envio automático.

Esta console é separada do fluxo comercial e não cria lead, piloto, campanha, outbox, attempt ou provider event.

## Pré-condições

- PR da API `OPERATOR_TEST` integrada e disponível no ambiente escolhido;
- migration `0021_operator_channel_test.sql` aplicada no banco do ambiente;
- API executando com configuração `OPERATOR_TEST` fail-closed;
- token com somente as permissões necessárias:
  - `operator-test:prepare`;
  - `operator-test:open`;
  - `operator-test:confirm`;
  - `operator-test:response`, apenas quando a resposta for utilizada;
- número pertencente ao operador em formato E.164;
- confirmação manual de que o número configurado na API e o número configurado localmente são o mesmo;
- `REAL_MANUAL_PILOT_BLOCKED=true` e `MESSAGES=NOT_SENT` para leads reais.

## Configuração local

Defina os valores somente na sessão atual do PowerShell. Não grave telefone ou token em arquivo versionado.

```powershell
$env:LEAD_FINDER_API_URL="https://URL-DA-API"
$segredo = Read-Host "Cole o token operator-test" -AsSecureString
$env:API_AUTH_TOKEN = [System.Net.NetworkCredential]::new("", $segredo).Password
$env:OPERATOR_TEST_AUTHORIZED="true"
$env:OPERATOR_TEST_WHATSAPP_E164="+55DDDNUMERO"
npm run operator:test:whatsapp
```

A porta padrão é `4174`. Para alterá-la:

```powershell
$env:OPERATOR_TEST_CONSOLE_PORT="4175"
```

Abra:

```text
http://127.0.0.1:4174
```

## Fluxo

1. a console mostra somente os quatro últimos dígitos do destino local;
2. o operador confere o texto fixo do teste;
3. **Criar preparação auditada** chama `POST /operator-tests/whatsapp/preparations` com corpo vazio;
4. a resposta da API é aceita somente se contiver o contrato sanitizado e fixo do `OPERATOR_TEST`;
5. telefone, mensagem e link `wa.me` permanecem somente na memória da console;
6. **Registrar abertura e abrir WhatsApp** registra `OPENED` na API antes do redirecionamento local para `wa.me`;
7. o operador revisa novamente destinatário e texto no WhatsApp;
8. o envio continua sendo exclusivamente humano;
9. o operador registra `SENT_CONFIRMED` ou `NOT_SENT` conforme o que realmente ocorreu;
10. uma resposta pode ser registrada somente após `SENT_CONFIRMED` e somente quando houver evidência real.

Abrir o WhatsApp não confirma envio. A console não lê o WhatsApp, não detecta entrega e não escolhe resultados automaticamente.

## Garantias locais

- bind exclusivo em `127.0.0.1`;
- validação do cabeçalho `Host`;
- CSRF aleatório por execução;
- corpo máximo de 8 KiB;
- política `no-store`;
- CSP restritiva;
- `Referrer-Policy: no-referrer`;
- API remota obrigada a usar HTTPS, exceto loopback local;
- URL limitada a `https://wa.me/<E164>?text=...`;
- nenhum parâmetro adicional no link;
- nenhum telefone completo ou link renderizado na página;
- resposta de preparação rejeitada caso contenha campos inesperados, mensagem, link ou fingerprint de destinatário;
- token, telefone e link não são escritos em disco;
- encerramento do processo apaga as preparações locais.

## Dados enviados à API

A console envia apenas:

- corpo vazio na preparação;
- UUID de preparação na rota;
- `Idempotency-Key` aleatória por operação;
- enum de confirmação ou resposta.

A console não envia telefone, mensagem, URL `wa.me`, lead, contato, piloto ou payload comercial.

## Interrupção obrigatória

Interrompa sem confirmar envio quando ocorrer:

- divergência entre o número local e o número configurado na API;
- resposta da API com campo inesperado;
- domínio diferente de `wa.me`;
- mensagem divergente;
- erro de autorização;
- kill switch acionado;
- replay ou conflito inesperado;
- PII ou secret em log;
- qualquer sinal de provider, webhook ou envio automático.

## Restrições

- não usar para leads, clientes ou terceiros;
- não usar Whatsmiau, WuzAPI, Evolution API, Baileys ou sessão por QR Code;
- não habilitar Meta Cloud API nesta etapa;
- não executar antes dos gates de banco, role e deploy controlado;
- não alterar o veredito do piloto comercial com base neste teste.

O teste fechado do operador e o piloto comercial permanecem domínios separados.
