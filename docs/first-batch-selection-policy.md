# Política de seleção — prospecção manual v2

**Decisão de produto:** `EXPAND_TO_WEAK_DIGITAL_PRESENCE`  
**Operação:** manual, individual, sem disparo em massa e sem follow-up automático.

## 1. Escopo ampliado

O Lead Finder Brasil deixa de limitar a prospecção a negócios totalmente sem site. Um candidato pode ser selecionado quando existir oportunidade digital objetiva em qualquer um destes estados:

- `NO_SITE`: não possui site institucional próprio;
- `THIRD_PARTY_ONLY`: depende apenas de Google, rede social, marketplace, Linktree ou página de agenda;
- `WEAK_SITE`: possui site, mas ele é desatualizado, incompleto, pouco funcional ou incompatível com a operação atual;
- `BROKEN_SITE`: domínio, HTTPS, navegação, formulário, CTA ou contato apresentam falha verificável;
- `WEAK_CONVERSION`: existe presença digital, mas faltam elementos essenciais de conversão, catálogo, orçamento, reserva, cardápio ou contato claro.

Ter site deixa de ser motivo automático de exclusão. A oferta deve mencionar apenas problemas reais e verificáveis, sem alegações enganosas.

## 2. Nichos permitidos

A prospecção pode avaliar, em ondas separadas:

1. barbearias, salões e estética não médica;
2. oficinas, auto centers, funilarias e serviços automotivos;
3. restaurantes, lanchonetes, pizzarias, cafeterias e delivery local;
4. eletricistas, encanadores, pintores, instaladores, limpeza e manutenção;
5. lojas locais, catálogos, moda, calçados, móveis e presentes;
6. pet shops, banho e tosa e serviços para animais não regulados;
7. academias, estúdios e escolas de atividades não reguladas;
8. eventos, fotografia, decoração e serviços criativos;
9. pequenas empresas B2B e prestadores profissionais com oferta digital clara.

Excluir do piloto inicial atividades ilegais, sensíveis, políticas, financeiras reguladas, saúde sensível, jogos, armas, drogas, conteúdo adulto e outras categorias incompatíveis com as políticas das plataformas.

## 3. Volume e organização

- até 30 candidatos por amostra de nicho;
- até 10 candidatos na shortlist privada;
- no máximo 5 primeiros contatos por onda;
- uma região principal por onda, podendo expandir para todo o Brasil após validação;
- revisão individual antes de cada contato;
- nenhum envio automático.

## 4. Critérios mínimos de inclusão

O candidato deve atender aos critérios abaixo:

1. negócio aparentemente ativo;
2. identidade comercial suficientemente verificável;
3. necessidade digital objetiva em um dos estados da seção 1;
4. oferta compatível com a necessidade encontrada;
5. fonte pública pertinente ou informação fornecida diretamente;
6. ausência de duplicidade;
7. ausência de opt-out, `do_not_contact`, `NAO_CONTATAR` ou bloqueio;
8. mensagem curta, identificada e individualmente revisada.

Uma fonte oficial coerente pode ser suficiente quando identidade, atividade e canal estão claros. Exigir segunda fonte somente em caso de ambiguidade, conflito ou risco maior.

## 5. Canais

### 5.1 E-mail empresarial

Pode ser considerado para um único primeiro contato manual quando:

- está publicado como contato comercial, institucional, atendimento, orçamento ou vendas;
- pertence ao negócio ou é usado publicamente pelo responsável para a atividade profissional;
- a fonte e a data da consulta são registradas;
- não existe supressão;
- a mensagem contém identificação e opt-out simples.

Gmail, Outlook ou outro domínio gratuito não é automaticamente pessoal. Ele pode ser classificado como `BUSINESS_USE_CONFIRMED` quando aparece de forma consistente como canal do negócio. Endereço claramente pessoal, familiar ou sem vínculo comercial permanece bloqueado.

### 5.2 Número público de telefone ou WhatsApp

Um número publicado no Google, site, rede social, placa digital ou diretório pode ser registrado como `PUBLIC_BUSINESS_NUMBER_DISCOVERED` quando está apresentado como canal do negócio.

Esse estado permite:

- confirmar identidade e atividade;
- priorizar aquisição de permissão;
- preparar um link ou material para uso depois do opt-in;
- registrar a fonte sem publicar o número no GitHub.

Ele não equivale a opt-in de WhatsApp. O primeiro contato via WhatsApp somente pode ocorrer após `DIRECT_OPT_IN`, `FORM_OPT_IN` ou `SIGNED_RECORD`, inclusive quando a conversa foi iniciada pelo próprio negócio.

### 5.3 Aquisição de permissão

A autorização para continuar no WhatsApp pode ser solicitada por um canal empresarial compatível, por exemplo:

- e-mail comercial;
- formulário de contato;
- mensagem direta em perfil empresarial, respeitando a política da plataforma;
- indicação, evento, parceria ou contato inbound;
- anúncio ou página com botão de WhatsApp e texto transparente.

A solicitação deve ser única, curta e sem pressão. Silêncio não é autorização.

## 6. Critérios de exclusão

Excluir ou manter bloqueado quando houver:

- negócio inativo ou identidade conflitante;
- dado sensível ou obtido de vazamento/lista comprada;
- contato claramente pessoal sem uso comercial demonstrado;
- pedido de não contato;
- duplicidade;
- mensagem sem relação com a necessidade encontrada;
- tentativa de contornar política de plataforma;
- evidência insuficiente após revisão razoável.

## 7. Pontuação de triagem

A pontuação ordena a revisão e não autoriza contato.

| Critério | Pontos |
|---|---:|
| negócio ativo confirmado | 2 |
| `NO_SITE` | 3 |
| `THIRD_PARTY_ONLY` | 2 |
| `WEAK_SITE`, `BROKEN_SITE` ou `WEAK_CONVERSION` comprovado | 2 |
| demonstração compatível disponível | 2 |
| e-mail de uso comercial confirmado | 3 |
| número público apresentado como canal comercial | 1 |
| oportunidade específica e verificável | 2 |
| mesma região da onda | 1 |
| identidade ou propriedade ambígua | -4 |
| opt-out ou bloqueio | exclusão |

## 8. Evidência mínima

Registrar de forma privada:

- nome público do negócio;
- nicho e região;
- estado da presença digital;
- fonte e data;
- resumo objetivo da oportunidade;
- classificação do canal;
- decisão do revisor;
- supressões e resultado.

Não publicar telefone, e-mail, nome desnecessário de pessoa física, mensagens integrais, prints com PII, payload bruto ou credenciais.

## 9. Fluxo operacional

1. coletar até 30 candidatos do nicho;
2. remover duplicados e inativos;
3. classificar a presença digital;
4. registrar uma oportunidade objetiva;
5. classificar o canal disponível;
6. consultar supressões;
7. formar shortlist de até 10;
8. selecionar até 5;
9. personalizar mensagem e demonstração;
10. obter aprovação humana por lead;
11. executar manualmente pelo canal elegível;
12. registrar resultado e aplicar opt-out imediatamente.

## 10. Estados finais

- `APPROVED_FOR_MANUAL_EMAIL`;
- `READY_TO_REQUEST_WHATSAPP_OPT_IN`;
- `WHATSAPP_OPT_IN_CONFIRMED`;
- `NEEDS_REVIEW`;
- `REJECTED`;
- `DO_NOT_CONTACT`.

Nenhum desses estados autoriza automação de WhatsApp Web, disparo em massa ou envio por provider não aprovado.