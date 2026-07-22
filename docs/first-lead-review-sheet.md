# Ficha individual de revisão de lead — lote manual

Copiar esta ficha para um armazenamento privado por lead. Não preencher dados pessoais reais em issue, PR, log ou artifact público.

## Identificação operacional

- ID interno do lead:
- categoria:
- cidade/região:
- data da revisão:
- revisor autenticado:
- lote/piloto:

## Verificação do negócio

- [ ] negócio aparenta estar ativo;
- [ ] nome público confirmado;
- [ ] categoria confirmada;
- [ ] localização compatível com o lote;
- [ ] não possui site funcional ou apresenta necessidade digital verificável;
- [ ] não há alegação comercial não comprovada;
- [ ] não é duplicado de outro lead do lote.

### Evidência mínima

- tipo de fonte pública:
- URL ou referência privada da fonte:
- data de consulta:
- resumo objetivo da evidência, sem payload bruto:

## Estado de supressão

- [ ] `is_blocked = false`;
- [ ] `do_not_contact = false`;
- [ ] CRM diferente de `NAO_CONTATAR`;
- [ ] sem opt-out global;
- [ ] sem opt-out do canal selecionado;
- [ ] sem contato anterior incompatível com o novo contato;

Qualquer item desfavorável resulta em `REJECTED / DO_NOT_CONTACT`.

## Avaliação de canal

### WhatsApp

- número válido:
- número pertence ao lead correto:
- origem da autorização:
  - [ ] `DIRECT_OPT_IN`;
  - [ ] `FORM_OPT_IN`;
  - [ ] `SIGNED_RECORD`;
- finalidade autorizada:
- fingerprint da evidência registrado:
- [ ] autorização explícita atual e compatível;

Número público encontrado em site, diretório ou rede social não é opt-in.

### E-mail

- endereço sintaticamente válido:
- endereço verificado:
- fonte pública pertinente:
- propriedade:
  - [ ] `BUSINESS`;
  - [ ] `PERSONAL`;
  - [ ] `UNKNOWN`;
- origem da evidência:
  - [ ] `PUBLIC_BUSINESS_SOURCE`;
  - [ ] `DIRECTLY_PROVIDED`;
  - [ ] `SIGNED_RECORD`;
- decisão humana:
  - [ ] `APPROVED`;
  - [ ] `REJECTED`;
- versão da evidência:
- fingerprint da evidência:

Somente `BUSINESS / APPROVED` permite e-mail.

## Decisão de elegibilidade

- [ ] WhatsApp autorizado;
- [ ] e-mail empresarial aprovado;
- [ ] nenhum canal elegível;

Canal escolhido:

- [ ] WhatsApp;
- [ ] e-mail;
- [ ] não contatar.

Justificativa objetiva:

## Revisão da mensagem

- template e versão:
- demonstração/segmento relacionado:
- [ ] identifica Bruno F. Salustiano;
- [ ] identifica Lead Finder Brasil;
- [ ] finalidade clara e breve;
- [ ] conteúdo pertinente ao negócio;
- [ ] origem do e-mail informada quando aplicável;
- [ ] opt-out simples;
- [ ] sem tracking;
- [ ] sem anexo inesperado;
- [ ] sem alegação não comprovada;
- [ ] sem link no primeiro contato, salvo autorização específica;
- [ ] sem promessa de resultado garantido;

## Aprovação humana final

- veredito:
  - [ ] `APPROVED`;
  - [ ] `REJECTED`;
  - [ ] `NEEDS_REVIEW`;
  - [ ] `DO_NOT_CONTACT`;
- aprovado por:
- data/hora:
- janela manual prevista:
- observação sanitizada:

## Registro posterior

- preparação criada:
- abertura manual registrada:
- confirmação humana:
  - [ ] `SENT_CONFIRMED`;
  - [ ] `NOT_SENT`;
  - [ ] `INVALID_CONTACT`;
  - [ ] `CHANNEL_UNAVAILABLE`;
  - [ ] `OPERATIONAL_ERROR`;
- resposta:
  - [ ] `POSITIVE_REPLY`;
  - [ ] `NEGATIVE_REPLY`;
  - [ ] `OPT_OUT`;
- [ ] opt-out aplicado imediatamente quando solicitado;
- [ ] nenhum follow-up automático criado;
