# Avaliação de legítimo interesse — primeiro contato comercial por e-mail

**Status:** avaliação operacional preliminar e condicional.  
**Escopo:** primeiro lote manual de até cinco negócios.  
**Responsável operacional:** Bruno F. Salustiano — Lead Finder Brasil.  
**Canal de privacidade e opt-out:** `leadfinderbrasil@gmail.com`.

> Este documento organiza a análise interna de privacidade. Ele não substitui orientação jurídica profissional nem autoriza contato automático.

## 1. Operação avaliada

Contato comercial individual por e-mail empresarial publicado pelo próprio negócio ou por fonte pública pertinente, para apresentar serviços de presença digital e desenvolvimento de sites.

A operação não inclui:

- WhatsApp sem autorização explícita;
- dados pessoais sensíveis;
- listas compradas;
- tracking pixel ou monitoramento invisível;
- anexos inesperados;
- disparo em massa;
- follow-up automático;
- decisões de envio tomadas por IA;
- coleta autenticada ou invasiva.

## 2. Finalidade

Finalidade específica: apresentar, uma única vez e de forma identificada, uma oferta potencialmente pertinente a um negócio que aparenta não possuir presença digital adequada.

A finalidade deve ser:

- legítima e compatível com a atividade comercial do Lead Finder Brasil;
- específica e explícita;
- compreensível para o destinatário;
- limitada ao contato inicial revisado individualmente.

Não é permitido reutilizar o endereço para publicidade genérica, enriquecimento de perfil, revenda, compartilhamento comercial ou nova campanha sem nova avaliação.

## 3. Necessidade

Dados mínimos propostos:

- nome empresarial ou nome público do negócio;
- categoria e cidade/região;
- endereço de e-mail empresarial publicado;
- URL da fonte pública;
- classificação humana da propriedade do e-mail;
- registro de contato, resposta e opt-out;
- identificadores técnicos mínimos para idempotência e auditoria.

Não coletar:

- CPF;
- documentos pessoais;
- dados de saúde, religião, opinião política, biometria ou outros dados sensíveis;
- perfis pessoais de familiares ou funcionários;
- payload bruto de páginas;
- histórico de navegação;
- informações sem relação direta com a finalidade.

Alternativas menos invasivas consideradas:

1. aguardar contato inbound;
2. anúncios públicos;
3. formulário de interesse;
4. contato pelo canal empresarial indicado pelo próprio negócio.

Para o piloto, o e-mail empresarial público é usado somente quando o contato inbound não existe e o endereço foi claramente disponibilizado para comunicação profissional.

## 4. Balanceamento

### Expectativa razoável

A expectativa é considerada mais favorável quando:

- o endereço está apresentado como canal comercial ou institucional;
- o destinatário representa um negócio ativo;
- a mensagem tem relação direta com a atividade do negócio;
- o remetente se identifica claramente;
- a origem do endereço é informada quando apropriado;
- a frequência é limitada a um contato inicial;
- o opt-out é simples e imediato.

A expectativa é considerada desfavorável quando:

- o endereço parece pessoal;
- a propriedade é `UNKNOWN` ou `PERSONAL`;
- a fonte é ambígua ou não verificável;
- o negócio não está ativo;
- a mensagem não é pertinente ao segmento;
- já houve pedido de interrupção;
- existe bloqueio global, `do_not_contact` ou `NAO_CONTATAR`.

### Impactos possíveis

- incômodo ou interrupção;
- percepção de spam;
- uso indevido de endereço pessoal publicado por engano;
- repetição de contato após recusa;
- exposição indevida de dados em logs ou evidências.

### Salvaguardas obrigatórias

- seleção manual de no máximo cinco negócios;
- revisão individual da fonte e da propriedade do e-mail;
- mensagem curta, pertinente e identificada;
- nenhum link no primeiro contato sem autorização, conforme regra do piloto;
- nenhum tracking ou anexo inesperado;
- opt-out em linguagem simples;
- supressão imediata e permanente até reativação explícita autorizada;
- zero follow-up automático;
- zero provider real ou worker de envio;
- logs e issues sem dados pessoais de leads;
- revalidação de elegibilidade antes de preparar, abrir ou confirmar contato.

## 5. Teste de três etapas

### 5.1 Finalidade

- [x] finalidade comercial definida e específica;
- [x] operação compatível com os serviços oferecidos;
- [x] nenhum objetivo oculto ou secundário;
- [ ] revisar a finalidade para cada novo segmento.

### 5.2 Necessidade

- [x] conjunto de dados reduzido;
- [x] proibição de dados sensíveis;
- [x] contato individual e não automatizado;
- [ ] confirmar que não existe alternativa inbound adequada para cada lead.

### 5.3 Balanceamento e salvaguardas

- [x] mensagem identificada;
- [x] opt-out imediato;
- [x] ausência de tracking e follow-up automático;
- [x] classificação de propriedade do e-mail;
- [x] supressão fail-closed;
- [ ] aprovação humana final por lead;
- [ ] revisão jurídica profissional antes de aumentar escala ou frequência.

## 6. Decisão operacional

**Resultado preliminar:** `CONDITIONAL`.

O primeiro contato por e-mail somente pode ocorrer quando todos os critérios abaixo forem verdadeiros:

1. negócio ativo e dentro do segmento/região do lote;
2. endereço público claramente empresarial e pertinente;
3. decisão humana atual `BUSINESS / APPROVED`;
4. ausência de opt-out de e-mail ou global;
5. ausência de bloqueio, `do_not_contact` e `NAO_CONTATAR`;
6. mensagem revisada individualmente;
7. aviso de privacidade acessível;
8. aprovação explícita de Bruno para aquele lead;
9. envio manual pelo canal oficial;
10. registro do resultado sem PII pública.

Qualquer dúvida resulta em `DO_NOT_CONTACT` ou retorno para revisão.

## 7. Retenção proposta para o piloto

Política provisória, sujeita a revisão:

- candidato rejeitado ou não contatado: excluir ou anonimizar em até 30 dias após a triagem;
- lead contatado sem relação comercial: revisar em 180 dias e eliminar/minimizar em até 12 meses da última interação;
- mensagens e observações: manter somente o necessário para auditoria do piloto;
- opt-out e supressão: manter registro mínimo enquanto necessário para impedir novo contato;
- dados agregados e anonimizados: podem ser mantidos para avaliação do piloto.

## 8. Direitos e atendimento

Solicitações de confirmação, acesso, correção, oposição, bloqueio ou eliminação devem ser recebidas pelo e-mail `leadfinderbrasil@gmail.com` e tratadas sem exigir justificativa para opt-out.

O pedido de interrupção deve ser aplicado imediatamente antes de qualquer nova operação de contato.

## 9. Revisão

Reavaliar este documento quando ocorrer qualquer mudança em:

- categoria ou região;
- volume ou frequência;
- fonte dos dados;
- canal utilizado;
- inclusão de provider externo;
- uso de IA;
- política de follow-up;
- prazo de retenção;
- modelo de negócio ou identidade do controlador.

## Referências oficiais

- Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018, especialmente arts. 7º, 10, 16, 17 e 18.
- ANPD — Guia Orientativo das Hipóteses Legais de Tratamento de Dados: Legítimo Interesse, versão 1.0.
- ANPD — Direitos dos Titulares de Dados Pessoais.
