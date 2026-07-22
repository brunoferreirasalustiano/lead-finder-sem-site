# Política de seleção — primeiro lote manual

## Escopo recomendado

- **Categoria inicial:** barbearias;
- **Região inicial:** Campinas/SP e municípios imediatamente próximos;
- **Tamanho máximo:** cinco negócios elegíveis;
- **Triagem inicial:** até dez candidatos;
- **Operação:** manual, individual e sem follow-up automático.

A escolha é operacionalmente adequada ao piloto porque já existe demonstração do segmento e familiaridade regional. Ela pode ser alterada antes da seleção de candidatos, desde que o lote permaneça restrito a uma categoria e uma região.

## Critérios obrigatórios de inclusão

O candidato deve atender a todos os critérios:

1. negócio aparentemente ativo;
2. categoria compatível com o lote;
3. localização dentro da região aprovada;
4. presença digital inexistente, incompleta ou claramente melhorável, com evidência objetiva;
5. contato pertencente ao próprio negócio;
6. fonte pública pertinente ou fornecimento direto;
7. ausência de duplicidade;
8. ausência de bloqueio global, `do_not_contact` e `NAO_CONTATAR`;
9. ausência de opt-out do canal selecionado;
10. mensagem potencialmente pertinente ao contexto do negócio.

## Critérios de exclusão

Excluir imediatamente quando houver:

- site funcional e adequado que elimine a hipótese central da oferta;
- negócio fechado, inativo ou com informação conflitante;
- endereço de contato pessoal ou de propriedade incerta;
- e-mail genérico obtido de lista, vazamento ou fonte não verificável;
- telefone público sem opt-in de WhatsApp;
- contato de funcionário sem relação aparente com decisões do negócio;
- dado sensível;
- pedido anterior de não contato;
- duplicidade no CRM;
- evidência insuficiente;
- qualquer dúvida relevante sobre identidade, origem ou pertinência.

## Regra de canal

### WhatsApp

Permitido somente com evidência explícita atual:

- `DIRECT_OPT_IN`;
- `FORM_OPT_IN`;
- `SIGNED_RECORD`.

Publicação do número em site, perfil social, mapa ou diretório não é opt-in.

### E-mail

Permitido somente quando:

- o endereço é válido e verificado;
- a fonte é pertinente;
- a propriedade atual foi classificada como `BUSINESS`;
- a decisão humana atual é `APPROVED`;
- não existe supressão do canal ou global.

Endereço Gmail, Outlook ou similar não é automaticamente pessoal nem empresarial. A decisão depende da evidência concreta e da revisão humana.

## Pontuação de triagem

A pontuação serve apenas para ordenar a revisão; não autoriza contato.

| Critério | Pontos |
|---|---:|
| negócio ativo confirmado por duas evidências públicas coerentes | 2 |
| ausência de site ou site claramente indisponível | 3 |
| demonstração existente compatível com o segmento | 2 |
| e-mail empresarial claramente publicado | 3 |
| necessidade digital objetiva e verificável | 2 |
| localização dentro da região principal | 1 |
| contato ou identidade ambígua | -5 |
| pedido de não contato ou bloqueio | exclusão |

Priorizar candidatos com maior pontuação, mas submeter todos à ficha individual antes da decisão.

## Evidência permitida

Registrar somente:

- tipo da fonte;
- URL ou referência privada;
- data da consulta;
- resumo objetivo;
- fingerprint quando necessário;
- decisão e revisor.

Não armazenar em repositório público:

- endereço de e-mail real do lead;
- telefone real do lead;
- nome de pessoa física não necessário;
- captura com dados pessoais;
- payload bruto;
- mensagem completa enviada;
- credencial ou token.

## Processo de redução de dez para cinco

1. levantar até dez candidatos;
2. eliminar inativos e duplicados;
3. verificar presença digital;
4. verificar fonte e propriedade do contato;
5. consultar supressões;
6. preencher a ficha individual;
7. ordenar pelos critérios objetivos;
8. selecionar no máximo cinco;
9. revisar mensagem e demonstração;
10. obter aprovação explícita de Bruno por lead.

## Critério de parada

Interromper toda a preparação quando ocorrer:

- contato indevido;
- opt-out não aplicado;
- divergência de identidade;
- exposição de PII;
- falha de supressão;
- qualquer efeito externo automático;
- erro de configuração de provider;
- impossibilidade de comprovar a origem ou a elegibilidade.

## Veredito por candidato

Cada candidato deve terminar em um destes estados:

- `APPROVED_FOR_MANUAL_CONTACT`;
- `NEEDS_REVIEW`;
- `REJECTED`;
- `DO_NOT_CONTACT`.

Somente o primeiro estado permite avançar para a aprovação humana final. Ainda assim, ele não autoriza envio automático.
