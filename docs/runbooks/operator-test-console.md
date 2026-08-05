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
- a mesma `OPERATOR_TEST_RECIPIENT_BINDING_KEY` exclusiva configurada na API e na console;
- fingerprint sanitizada de 12 caracteres calculada para a Binding Key configurada no HML;
- `OPERATOR_TEST_RECIPIENT_BINDING_KEY` com 32 a 512 caracteres ASCII imprimíveis sem espaços, diferente de `API_AUTH_TOKEN` e `OPERATOR_TEST_FINGERPRINT_KEY`;
- `REAL_MANUAL_PILOT_BLOCKED=true` e `MESSAGES=NOT_SENT` para leads reais.

## Configuração local

Use o launcher em uma sessão efêmera. Não grave telefone, token, Binding Key ou Fingerprint Key em arquivo versionado.

A fingerprint sanitizada não é segredo e deve ser fornecida em tempo de execução. O launcher não contém fingerprint específica de ambiente fixada no Git.

```powershell
$expectedHmlBindingFingerprint = "0123456789ab" # exemplo sintético de 12 caracteres

powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\operator-test-whatsapp-session.ps1 `
  -ExpectedHmlBindingFingerprint $expectedHmlBindingFingerprint
```

Como alternativa, a mesma fingerprint sanitizada pode existir somente na variável de ambiente do processo:

```powershell
$env:OPERATOR_TEST_HML_BINDING_FINGERPRINT = $expectedHmlBindingFingerprint
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\operator-test-whatsapp-session.ps1
```

O launcher confirma o diretório autorizado, solicita o número do operador e os três segredos com `Read-Host -AsSecureString`, configura somente variáveis de ambiente do processo, confirma a leitura de volta, calcula as fingerprints sanitizadas e executa o preflight na mesma sessão. O número completo e os segredos nunca são impressos. A console só é iniciada após `PASS`.

Para validar o carregamento sem HML, sem API e sem console, use exclusivamente os segredos sintéticos internos:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\operator-test-whatsapp-session.ps1 -TestMode
```

O modo de teste confirma a herança para processos Node, tsx e npm e encerra com `CONSOLE_STARTED=false`.

O preflight é obrigatório e falha antes de iniciar a console quando o destinatário local não coincide com o sufixo autorizado ou com o sufixo sanitizado do HML, quando a fingerprint local da chave não coincide com a fingerprint sanitizada informada, ou quando há segredo inválido, bloco PowerShell, whitespace, caractere invisível, build incompleto, worktree sujo, porta ocupada ou API não saudável. Ele executa somente leituras de saúde da API; não cria preparação, não chama WhatsApp e não chama Meta.

`recipientE164` participa da entrada do HMAC. Portanto, uma divergência entre o número local e o número configurado na API é causa suficiente para `INVALID_OPERATOR_RECIPIENT_BINDING`; corrija a configuração privada e reinicie a sessão antes de qualquer nova preparação.

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
3. **Criar preparação auditada** gera nonce e `Idempotency-Key`, calcula a prova criptográfica do destino local e chama `POST /operator-tests/whatsapp/preparations`;
4. a API só prepara após validar a prova contra seu destino autorizado;
5. a resposta da API é aceita somente se contiver o contrato sanitizado e um recibo criptográfico válido;
6. telefone, mensagem, link `wa.me` e recibo permanecem somente na memória da console;
7. antes de `/open`, `/confirm` e `/response`, a console recalcula e valida novamente o recibo;
8. **Abrir WhatsApp manualmente** abre o link localmente e não registra o evento `OPENED`;
9. o operador revisa novamente destinatário e texto no WhatsApp, sem enviar;
10. **Registrar que abri o WhatsApp** grava `OPENED` na API;
11. o envio continua sendo exclusivamente humano no WhatsApp;
12. o operador registra `SENT_CONFIRMED` ou `NOT_SENT` conforme o que realmente ocorreu;
13. uma resposta pode ser registrada somente após `SENT_CONFIRMED` e somente quando houver evidência real.

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
- mismatch de proof ou recibo apaga a preparação local e impede abertura e eventos;
- token, chaves, proof, recibo, telefone e link não são escritos em disco ou logs;
- encerramento do processo apaga as preparações locais.

## Dados enviados à API

A console envia apenas:

- versão fixa, nonce aleatório e proof HMAC na preparação;
- UUID de preparação na rota;
- `Idempotency-Key` aleatória por operação;
- enum de confirmação ou resposta.

A console não envia telefone, mensagem, URL `wa.me`, recibo, lead, contato, piloto ou payload comercial.

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
