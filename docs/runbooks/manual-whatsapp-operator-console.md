# Console local de WhatsApp manual

## Objetivo

Operar o fluxo manual assistido do Lead Finder Brasil com custo zero, usando o WhatsApp Business e links `wa.me`, sem automatizar o WhatsApp Web e sem afirmar envio antes da confirmação humana.

A console:

- executa somente em `127.0.0.1`;
- usa a API autenticada já existente;
- exige um contato de WhatsApp elegível e com opt-in explícito;
- prepara a mensagem com o template aprovado;
- registra `OPENED` antes de abrir o WhatsApp;
- abre o link em uma nova aba por ação humana;
- exige confirmação `SENT_CONFIRMED` ou `NOT_SENT`;
- nunca envia a mensagem automaticamente;
- não grava token, telefone, e-mail ou link no Git.

## Pré-condições

- Node.js 22 ou superior;
- dependências instaladas com `npm ci`;
- API acessível por HTTPS, ou HTTP apenas em loopback local;
- token com no mínimo estas permissões:
  - `manual-messaging:prepare`;
  - `manual-messaging:open`;
  - `manual-messaging:confirm`;
- piloto no estado `RUNNING`;
- revisão humana do lead aprovada;
- contato válido e verificado;
- autorização explícita de WhatsApp registrada;
- ausência de opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR` e bloqueio administrativo;
- template `pilot-whatsapp-first-contact` versão `v1` disponível.

A console não contorna nenhum desses gates. A API deve responder `INELIGIBLE` quando qualquer pré-condição falhar.

## Inicialização no Windows PowerShell

Defina as variáveis somente na sessão atual do terminal:

```powershell
$env:LEAD_FINDER_API_URL="https://URL-DA-API"
$env:API_AUTH_TOKEN="TOKEN-PRIVADO-COM-32-OU-MAIS-CARACTERES"
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

Nunca coloque o token em arquivo versionado, issue, PR, log, print ou histórico de comando compartilhado.

## Operação

1. informe `pilotRunId`, `leadId` e `contactId` obtidos do tracker privado;
2. clique em **Preparar mensagem**;
3. revise a mensagem integral exibida localmente;
4. clique em **Registrar abertura e abrir WhatsApp**;
5. revise novamente o número e o texto dentro do WhatsApp Business;
6. pressione **Enviar** somente se tudo estiver correto;
7. volte à console;
8. selecione **Confirmar que enviei** ou **Registrar que não enviei**.

A abertura do WhatsApp não representa envio. Somente a confirmação humana registra `SENT_CONFIRMED`.

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
