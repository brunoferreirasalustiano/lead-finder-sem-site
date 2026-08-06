# Controle de execução, incidentes e métricas do primeiro lote manual

## Finalidade

Padronizar o registro do primeiro lote de até cinco negócios sem tracking, inferências de leitura, follow-up automático ou exposição pública de dados pessoais.

Este documento não autoriza envio. Cada contato exige canal elegível, supressões limpas, mensagem revisada e aprovação explícita de Bruno F. Salustiano.

## Estados operacionais

| Estado | Significado |
|---|---|
| `CANDIDATE` | negócio localizado, ainda sem decisão de canal |
| `NEEDS_REVIEW` | identidade, site ou canal ainda precisa de prova |
| `ELIGIBLE` | canal e fundamento revisados, sem autorização de envio |
| `APPROVED_NOT_SENT` | Bruno aprovou a mensagem individual; envio ainda não confirmado |
| `OPENED` | cliente de e-mail ou WhatsApp foi aberto pelo operador; não representa envio |
| `SENT_CONFIRMED` | operador confirmou manualmente o envio realizado |
| `NOT_SENT` | operação encerrada sem envio |
| `RESPONSE_RECORDED` | resposta humana registrada separadamente |
| `OPT_OUT` | interrupção imediata e supressão aplicada |
| `BLOCKED` | contato proibido por elegibilidade, DNC, `NAO_CONTATAR` ou incidente |

## Registro mínimo por lead

O registro privado deve conter somente:

- ID interno;
- nome empresarial;
- categoria e região;
- fonte pública mínima;
- status do site;
- canal escolhido;
- fundamento de elegibilidade;
- template e versão;
- decisão humana;
- estado operacional;
- timestamps gerados pelo servidor ou registrados pelo operador;
- resultado comercial padronizado;
- observação curta e sanitizada.

Não registrar em issue, log ou artifact público:

- telefone;
- e-mail;
- mensagem integral;
- URL de contato completa;
- payload bruto;
- screenshot com dados pessoais;
- tokens ou connection strings.

## Checklist antes de preparar

- [ ] negócio ativo e identificado;
- [ ] categoria e região dentro do lote;
- [ ] site próprio verificado;
- [ ] contato pertence ao lead selecionado;
- [ ] canal elegível comprovado;
- [ ] WhatsApp possui opt-in explícito atual, quando usado;
- [ ] e-mail está classificado como `BUSINESS / APPROVED`, quando usado;
- [ ] opt-out por canal ausente;
- [ ] opt-out global ausente;
- [ ] `do_not_contact=false`;
- [ ] estágio diferente de `NAO_CONTATAR`;
- [ ] bloqueio administrativo ausente;
- [ ] template aprovado e versão registrada;
- [ ] WhatsApp no primeiro contato sem link, PDF, imagem, proposta, preço ou tracking;
- [ ] e-mail com link usa exclusivamente `pilot-email-first-contact@v2` e `https://brunoferreirasalustiano.github.io/lead-finder-demos/`, sem tracking, PDF, imagem, anexo, proposta ou preço;
- [ ] diagnóstico individual confirmou ausência de site oficial próprio antes de aprovar o e-mail v2;
- [ ] aprovação humana ainda não confundida com envio.

A exceção do e-mail v2 é estreita: nenhum outro link, encurtador ou parâmetro de rastreamento é permitido no primeiro contato.

## Checklist de execução manual

1. Abrir o cliente oficial no dispositivo do operador.
2. Conferir novamente empresa e canal.
3. Conferir a mensagem individual.
4. Registrar `OPENED` somente após abrir o cliente.
5. Realizar ou cancelar o envio manual.
6. Registrar `SENT_CONFIRMED` somente quando o operador comprovar que enviou.
7. Caso não envie, registrar `NOT_SENT`.
8. Nunca registrar envio com base apenas na abertura do link.
9. Não enviar segundo contato automaticamente.
10. Aplicar opt-out imediatamente após qualquer pedido de interrupção.

## Resultados padronizados

### Confirmação manual

- `SENT_CONFIRMED`;
- `NOT_SENT`;
- `INVALID_CONTACT`;
- `CHANNEL_UNAVAILABLE`;
- `OPERATIONAL_ERROR`.

### Resposta

- `POSITIVE_REPLY`;
- `NEGATIVE_REPLY`;
- `OPT_OUT`.

Respostas livres podem ser resumidas em uma observação curta, sem copiar conteúdo sensível ou desnecessário.

## Métricas permitidas

- candidatos pesquisados;
- candidatos excluídos por já possuírem site;
- candidatos sem canal elegível;
- candidatos em revisão;
- leads aprovados;
- mensagens preparadas;
- mensagens confirmadas manualmente como enviadas;
- mensagens não enviadas;
- respostas positivas;
- respostas negativas;
- opt-outs;
- contatos inválidos;
- erros operacionais;
- incidentes;
- tempo humano total do lote.

## Métricas proibidas

- taxa de abertura inferida;
- leitura de e-mail inferida;
- envio inferido pela abertura de `mailto:` ou `wa.me`;
- tracking pixel;
- fingerprint de navegação;
- conversão inventada;
- estimativa apresentada como resultado real;
- mistura entre mensagens preparadas e mensagens enviadas.

## Runbook de incidente

### Gatilhos

- contato realizado sem canal elegível;
- duplicidade;
- mensagem para lead bloqueado;
- opt-out não aplicado;
- envio diferente do aprovado;
- link ou anexo fora da exceção explícita do e-mail v2;
- exposição de PII em log, artifact ou issue;
- provider ou egress inesperado;
- resultado registrado incorretamente.

### Resposta imediata

1. Parar o lote.
2. Não iniciar novo contato.
3. Aplicar opt-out ou bloqueio quando pertinente.
4. Ativar kill switch se existir risco de efeito externo.
5. Registrar o tipo de incidente sem PII.
6. Identificar registros potencialmente afetados.
7. Corrigir estado e supressões sem apagar histórico append-only.
8. Verificar logs e outbox.
9. Emitir decisão `RESUME`, `ADJUST` ou `STOP`.
10. Retomar somente após revisão humana.

## Avaliação final do lote

O lote termina com um dos seguintes vereditos:

- `APPROVED`: processo seguro e copy adequada;
- `NEEDS_ADJUSTMENT`: sem incidente grave, mas canal, copy ou fluxo precisa de correção;
- `STOPPED`: incidente ou risco impede continuidade;
- `BLOCKED`: gates técnicos, jurídicos ou operacionais não foram concluídos.

Nenhum segundo lote começa antes da avaliação do primeiro.

## Critério de prontidão

`FIRST_BATCH_CONTROL_PACK_READY`
