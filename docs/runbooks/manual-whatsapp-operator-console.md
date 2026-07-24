# Console local de WhatsApp manual

## Objetivo

Operar o fluxo manual assistido do Lead Finder Brasil com custo zero, usando o WhatsApp Business e links `wa.me`, sem automatizar o WhatsApp Web e sem afirmar envio antes da confirmação humana.

A console possui dois modos explicitamente separados:

1. **teste do operador** — abre uma mensagem interna para um número pessoal autorizado, sem criar lead, piloto ou registro comercial;
2. **fluxo de piloto** — usa a API autenticada e exige todos os gates de elegibilidade do banco.

Em ambos os modos, a console:

- executa somente em `127.0.0.1`;
- abre o WhatsApp somente por ação humana;
- nunca envia a mensagem automaticamente;
- não grava token, telefone, e-mail ou link no Git.

## Pré-condições gerais

- Node.js 22 ou superior;
- dependências instaladas com `npm ci`;
- API acessível por HTTPS, ou HTTP apenas em loopback local;
- token com no mínimo estas permissões:
  - `manual-messaging:prepare`;
  - `manual-messaging:open`;
  - `manual-messaging:confirm`.

## Teste exclusivo do operador

O teste do operador serve somente para provar abertura do `wa.me`, formatação e envio humano para um número pertencente ao próprio operador.

Defina as variáveis somente na sessão atual do PowerShell:

```powershell
$env:OPERATOR_TEST_AUTHORIZED="true"
$env:OPERATOR_TEST_WHATSAPP_E164="+55DDDNUMERO"
```

Regras:

- o telefone precisa estar em E.164, começando com `+` e código do país;
- o número aparece apenas mascarado na página e no terminal;
- o número permanece somente na memória do processo;
- nenhum registro é criado no Supabase;
- nenhum estado `SENT_CONFIRMED` é gravado;
- o botão abre uma mensagem fixa identificada como teste interno;
- este modo é proibido para leads, clientes ou terceiros;
- fechar o PowerShell remove a variável e o número da sessão.

A autorização explícita é obrigatória. Configurar apenas o número, sem `OPERATOR_TEST_AUTHORIZED=true`, faz a console falhar fechada.

## Fluxo de piloto

Para um contato comercial real, são exigidos:

- piloto no estado `RUNNING`;
- revisão humana do lead aprovada;
- contato válido e verificado;
- autorização explícita de WhatsApp registrada;
- ausência de opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR` e bloqueio administrativo;
- template `pilot-whatsapp-first-contact` versão `v1` disponível.

A console não contorna nenhum desses gates. A API deve responder `INELIGIBLE` quando qualquer pré-condição falhar.

## Inicialização no Windows PowerShell

Defina as variáveis da API somente na sessão atual:

```powershell
$env:LEAD_FINDER_API_URL="https://URL-DA-API"
$segredo = Read-Host "Cole o API_AUTH_TOKEN" -AsSecureString
$env:API_AUTH_TOKEN = [System.Net.NetworkCredential]::new("", $segredo).Password
npm run operator:whatsapp
```

Opcionalmente, altere a porta local:

```powershell
$env:MANUAL_WHATSAPP_CONSOLE_PORT="4174"
```

Abra no navegador:

```text
http://127.0.0.1:4173
```

Nunca coloque o token ou o telefone em arquivo versionado, issue, PR, log, print ou histórico compartilhado.

## Operação do teste do operador

1. confirme que a página mostra apenas os quatro últimos dígitos corretos;
2. clique em **Abrir teste no meu WhatsApp**;
3. revise novamente o destinatário e a mensagem dentro do WhatsApp;
4. pressione **Enviar** somente se tudo estiver correto;
5. não use esse botão para qualquer terceiro.

Esse teste não produz evidência de entrega na API e não altera o gate de leads reais.

## Operação do fluxo de piloto

1. informe `pilotRunId`, `leadId` e `contactId` obtidos do tracker privado;
2. clique em **Preparar mensagem do piloto**;
3. revise a mensagem integral exibida localmente;
4. clique em **Registrar abertura e abrir WhatsApp**;
5. revise novamente o número e o texto dentro do WhatsApp Business;
6. pressione **Enviar** somente se tudo estiver correto;
7. volte à console;
8. selecione **Confirmar que enviei** ou **Registrar que não enviei**.

A abertura do WhatsApp não representa envio. Somente a confirmação humana registra `SENT_CONFIRMED` no fluxo de piloto.

## Segurança da console

- bind exclusivo em `127.0.0.1`;
- validação do cabeçalho `Host`;
- token disponível somente no processo Node;
- CSRF aleatório por execução;
- corpo máximo de 8 KiB;
- política `no-store`;
- CSP restritiva;
- `Referrer-Policy: no-referrer`;
- destino limitado a `https://wa.me/<E164>?text=...`;
- API remota obrigada a usar HTTPS;
- nenhuma persistência local das preparações;
- encerramento do processo apaga o estado em memória.

## Interrupção e incidente

Interrompa imediatamente quando ocorrer:

- número divergente;
- mensagem incorreta;
- duplicidade inesperada;
- preparação para contato sem opt-in;
- resposta `INELIGIBLE` inesperada;
- PII em logs;
- token exposto;
- abertura de domínio diferente de `wa.me`;
- contato ou mensagem enviados por engano.

Em incidente, não confirme envio, engate o kill switch quando aplicável e registre somente evidência sanitizada.

## Limitações intencionais

- não realiza envio automático;
- não lê respostas do WhatsApp;
- não usa WhatsApp Web automatizado;
- não usa Baileys, Evolution API, QR Code automatizado ou sessão não oficial;
- não substitui a Cloud API oficial;
- não libera contato com leads enquanto o gate #117 permanecer bloqueado.