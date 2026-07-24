# Lead Finder Brasil — Escopo Futuro do Produto

> **Natureza deste documento:** visão estratégica e escopo futuro do produto. Este arquivo não representa prontidão operacional e não autoriza deploy, coleta externa, envio, provider, webhook, egress ou contato real.
>
> **Estado atual:** partes relevantes da fundação técnica já estão implementadas ou em desenvolvimento no repositório. As integrações externas, a prospecção automática real, a qualificação conversacional por IA e a operação multiempresa permanecem condicionadas aos gates técnicos, jurídicos, comerciais e operacionais documentados.

## 1. Visão do produto

O **Lead Finder Brasil** está sendo desenvolvido para evoluir de um laboratório de prospecção assistida para uma plataforma brasileira de inteligência comercial, capaz de:

1. receber um produto, serviço ou oportunidade comercial de um cliente;
2. configurar público-alvo, região, perfil ideal e critérios de exclusão;
3. localizar potenciais compradores ou contratantes em fontes permitidas;
4. validar identidade, atividade, origem dos dados e compatibilidade inicial;
5. iniciar uma abordagem controlada em canais oficialmente integrados;
6. analisar respostas com assistência de IA;
7. realizar perguntas de qualificação previamente aprovadas;
8. bloquear opt-out, contatos indevidos, duplicidades e perfis incompatíveis;
9. encaminhar ao cliente somente oportunidades favoráveis ou que exijam atuação humana;
10. aprender com resultados confirmados, como reuniões, visitas, propostas e vendas.

A proposta de valor central é:

> **A IA encontra, organiza, inicia e qualifica. A equipe comercial do cliente recebe contexto, assume a negociação e conclui a venda.**

O Lead Finder Brasil não pretende ser apenas uma ferramenta de listas, disparos ou extração de contatos. O objetivo é reduzir ruído comercial e entregar oportunidades com evidência, contexto, intenção e próximo passo recomendado.

## 2. Estratégia completa de geração de leads

O produto deverá operar em três modalidades complementares.

### 2.1 Descoberta ativa de oportunidades

O cliente cadastra uma oferta e define:

- segmento desejado;
- região ou território;
- pessoa física ou jurídica;
- porte, atividade ou perfil econômico;
- problema que a oferta resolve;
- critérios mínimos de aderência;
- critérios de exclusão;
- canais permitidos;
- perguntas de qualificação;
- evento esperado para transferência ao vendedor.

A plataforma pesquisa potenciais interessados, valida os dados e prepara a primeira abordagem.

### 2.2 Prospecção conversacional assistida

Após os gates e integrações oficiais, a plataforma poderá:

- apresentar uma oferta aprovada;
- identificar respostas positivas, negativas, ambíguas ou automáticas;
- responder somente dentro de uma base de conhecimento autorizada;
- realizar perguntas curtas de qualificação;
- interromper imediatamente após opt-out;
- encaminhar dúvidas complexas para revisão humana;
- transferir oportunidades qualificadas ao cliente.

A IA não deverá criar condições comerciais, conceder descontos, alterar preços, prometer disponibilidade ou concluir contratos sem autorização explícita.

### 2.3 Qualificação de demanda recebida

A mesma infraestrutura poderá qualificar leads que chegaram voluntariamente por:

- landing pages;
- formulários;
- campanhas do cliente;
- QR Codes;
- site;
- chat;
- WhatsApp Business Platform;
- portais e marketplaces;
- integrações com CRM;
- APIs e webhooks assinados.

Essa modalidade complementa a prospecção ativa e permite que o produto processe tanto demanda encontrada quanto demanda recebida.

## 3. Exemplo futuro — corretora de imóveis

Uma corretora cadastra um imóvel, empreendimento ou conjunto de unidades disponíveis.

### Configuração da campanha

- tipo: compra ou locação;
- residencial, comercial, industrial ou terreno;
- cidade, bairros e raio de interesse;
- faixa de preço;
- área, quartos, vagas e características relevantes;
- perfil de comprador ou locatário;
- empresas ou atividades compatíveis, quando B2B;
- prazo esperado;
- condições de pagamento;
- perguntas permitidas;
- critérios de transferência ao corretor.

### Fluxo esperado

```text
Oferta disponível
  -> definição do público ideal
  -> descoberta de potenciais interessados
  -> validação e deduplicação
  -> abordagem inicial controlada
  -> análise da resposta por IA
  -> perguntas de qualificação
  -> pontuação e justificativa
  -> transferência ao corretor
  -> visita, proposta e resultado humano
```

### Exemplo de oportunidade encaminhada

```text
Classificação: ALTA_INTENCAO
Oferta: imóvel comercial LF-IM-042
Interesse: confirmado
Região: compatível
Faixa de investimento: compatível
Prazo: até 90 dias
Próximo passo: oferecer apresentação e agenda de visita
Confiança: alta
Revisão humana: obrigatória antes de qualquer compromisso comercial
```

O corretor recebe a conversa, os critérios atendidos, as objeções e o próximo passo. A negociação final permanece humana.

## 4. Vertical experimental atual — presença digital

A busca de empresas com presença digital insuficiente é a **Vertical Experimental 01** do Lead Finder Brasil.

Ela tem duas finalidades:

1. validar o pipeline técnico e operacional do produto;
2. permitir ao fundador testar uma fonte de renda complementar com criação de landing pages e sites institucionais.

Essa vertical não limita a visão futura do produto. Ela funciona como laboratório para:

- descoberta territorial;
- normalização;
- deduplicação;
- evidências;
- classificação de oportunidade;
- CRM;
- campanhas;
- revisão humana;
- supressões;
- mensageria assistida;
- métricas;
- rastreabilidade;
- aprendizado comercial.

### Oportunidades digitais permitidas

A ausência de um site cadastrado em uma fonte não prova que a empresa não possui site. A classificação deverá ser baseada em evidências e poderá utilizar estados como:

- `NO_SITE_LISTED` — a fonte consultada não informou site;
- `NO_OFFICIAL_SITE_CONFIRMED` — após revisão, não foi localizado site oficial claramente vinculado;
- `THIRD_PARTY_ONLY` — presença limitada a diretórios, marketplaces ou redes de terceiros;
- `SITE_UNREACHABLE` — site cadastrado, mas indisponível durante verificações controladas;
- `WEAK_SITE` — site existente com problemas técnicos, de conteúdo ou confiança;
- `WEAK_CONVERSION` — presença existente sem caminho claro para contato ou conversão;
- `PRESENCE_SUFFICIENT` — nenhuma oportunidade clara para oferta de presença digital;
- `REVIEW_REQUIRED` — evidência insuficiente ou conflitante.

Nenhum desses estados, isoladamente, autoriza contato.

## 5. Evolução da pesquisa territorial e Google Maps

Após os primeiros testes controlados, a descoberta deverá ser ampliada para combinar múltiplas fontes permitidas.

### Fontes previstas

- OpenStreetMap e Overpass;
- Google Places API, utilizando integrações oficiais e termos aplicáveis;
- sites oficiais e páginas empresariais claramente vinculadas;
- diretórios públicos permitidos;
- dados fornecidos pelo próprio cliente;
- fontes setoriais com licença ou autorização adequada;
- integrações futuras contratadas pelo cliente.

O projeto não deverá depender de raspagem não autorizada do Google Maps. A integração deverá usar APIs oficiais, controles de custo, atribuição, minimização de campos e revisão periódica dos termos aplicáveis.

Referências oficiais para a implementação futura:

- Google Places API — Text Search: `https://developers.google.com/maps/documentation/places/web-service/text-search`
- Google Places API — Nearby Search: `https://developers.google.com/maps/documentation/places/web-service/nearby-search`
- Termos da Google Maps Platform: `https://cloud.google.com/terms/maps-platform/pt-br`

### Estratégia de cobertura regional

A busca ampliada deverá considerar:

- divisão da região em células ou áreas menores;
- raio configurável;
- categorias oficiais e sinônimos regionais;
- múltiplas consultas por atividade;
- paginação controlada;
- limite de custo por fonte;
- deduplicação por identificador da fonte e identidade normalizada;
- detecção de filiais e unidades;
- registro da consulta que originou cada candidato;
- data de coleta e validade da evidência;
- amostragem para medir cobertura e falsos negativos.

### Análise da presença digital

A classificação deverá combinar sinais como:

- site informado pela fonte;
- site oficial localizado por revisão;
- domínio próprio;
- funcionamento do site;
- HTTPS;
- adaptação para dispositivos móveis;
- descrição clara de produtos ou serviços;
- localização e área atendida;
- chamada para ação;
- formulário ou canal de contato;
- consistência entre nome comercial, telefone, endereço e domínio;
- dependência exclusiva de redes sociais ou diretórios;
- qualidade mínima de conteúdo e conversão.

A plataforma deve registrar os sinais observados e a justificativa da classificação, evitando conclusões absolutas sem evidência.

## 6. Meta inicial de 60 leads por dia

A meta da fase ampliada será processar **60 empresas candidatas por dia**.

Essa meta significa:

- 60 registros descobertos ou recebidos;
- normalizados;
- deduplicados;
- analisados;
- classificados;
- registrados com evidência mínima.

Ela **não significa 60 mensagens enviadas por dia**.

A quantidade aprovada para contato dependerá dos gates de qualidade, canal, legitimidade, supressões e revisão humana.

### Funil diário proposto

```text
60 candidatos analisados
  -> remover duplicidades e unidades inválidas
  -> validar identidade e atividade
  -> verificar presença digital
  -> classificar oportunidade
  -> verificar origem e qualidade do canal
  -> consultar supressões
  -> revisão humana
  -> somente os aprovados entram em fila futura de abordagem
```

### Fases de aumento de volume

#### Fase A — validação de precisão

- pequeno lote;
- operação manual;
- comparação entre classificação e revisão humana;
- medição de falsos positivos;
- nenhum aumento de envio.

#### Fase B — capacidade de descoberta

- até 60 candidatos analisados por dia;
- coleta e classificação em dry-run ou shadow mode;
- revisão de amostras;
- nenhum contato automático.

#### Fase C — operação assistida

- somente após ambiente, canais e supressões comprovados;
- limites conservadores de abordagem;
- revisão humana;
- monitoramento de resposta, opt-out e reclamações;
- expansão gradual baseada em evidência.

#### Fase D — automação governada

- regras por tenant;
- canais oficiais;
- classificação por IA explicável;
- handoff humano;
- limites por segmento, região, remetente e campanha;
- rollback e kill switch testados.

## 7. Abordagem inicial para empresas sem site oficial confirmado

A primeira abordagem deverá ser curta, individual, contextual e sem alegar como fato algo que ainda pode estar incorreto.

### Proposta de mensagem inicial

> Olá, tudo bem? Encontrei sua empresa ao pesquisar por **[serviço] em [região]** e não localizei um site oficial claramente vinculado ao negócio. Posso estar enganado, por isso faço esta confirmação antes de enviar qualquer material.
>
> Criamos páginas profissionais para ajudar empresas locais a apresentar seus serviços e serem encontradas com mais facilidade por futuros clientes da região. Uma landing page pode colocar seu negócio à frente de concorrentes que ainda dependem somente de redes sociais ou diretórios.
>
> Posso preparar uma demonstração sem compromisso para você avaliar?

### Versão curta

> Olá! Encontrei sua empresa ao pesquisar por **[serviço] em [região]** e não localizei um site oficial claramente vinculado ao negócio. Criamos landing pages para apresentar seus serviços e facilitar que novos clientes encontrem e conheçam a empresa. Posso preparar uma demonstração sem compromisso?

### Princípios da abordagem

- confirmar antes de afirmar ausência de site;
- identificar remetente e finalidade;
- não enviar link no primeiro contato sem autorização;
- não usar pressão artificial;
- não prometer posicionamento garantido no Google;
- não alegar resultado futuro como certeza;
- registrar opt-out imediatamente;
- não insistir após negativa ou silêncio quando o limite definido for atingido;
- encaminhar dúvida ou conflito para revisão humana.

## 8. Módulos futuros do Lead Finder Brasil

### 8.1 Discover

Responsável por:

- fontes de descoberta;
- pesquisas territoriais;
- importação controlada;
- enriquecimento;
- normalização;
- deduplicação;
- evidências;
- sinais de oportunidade.

### 8.2 Campaign

Responsável por:

- oferta do cliente;
- público ideal;
- território;
- exclusões;
- templates;
- versões;
- limites;
- janelas;
- custos;
- estado da campanha.

### 8.3 Converse

Responsável por:

- recebimento de mensagens;
- respostas permitidas;
- base de conhecimento;
- detecção de intenção;
- dúvidas;
- opt-out;
- revisão humana;
- handoff.

### 8.4 Qualify

Responsável por:

- questionários por nicho;
- regras determinísticas;
- assistência de IA;
- score;
- justificativas;
- confiança;
- bloqueios;
- decisão humana final.

### 8.5 Route

Responsável por:

- encaminhamento por região;
- produto;
- unidade;
- equipe;
- disponibilidade;
- prioridade;
- SLA;
- agenda;
- CRM externo.

### 8.6 Learn

Responsável por:

- respostas;
- reuniões;
- visitas;
- propostas;
- vendas;
- perdas e motivos;
- falsos positivos e falsos negativos;
- desempenho das perguntas;
- calibração de score.

### 8.7 Trust

Responsável por:

- identidade e tenant;
- permissões;
- consentimento e origem;
- supressões;
- retenção;
- auditoria;
- segurança;
- incidentes;
- kill switch;
- conformidade.

## 9. Capacidades que já sustentam essa visão

O projeto já possui ou já desenvolve fundações que serão reutilizadas na evolução do produto:

- descoberta territorial por OpenStreetMap/Overpass com egress desligado por padrão;
- normalização de dados;
- deduplicação;
- scoring;
- registro de evidências;
- leads e contatos versionados;
- CRM com oportunidades, tarefas, notas, tags e timeline;
- campanhas e templates versionados;
- revisão humana;
- outbox transacional;
- leasing e concorrência;
- limites diários e janelas de execução;
- retry limitado;
- dead-letter e recuperação auditável;
- idempotência;
- pausa e cancelamento;
- opt-out e supressões;
- `DO_NOT_CONTACT` e `NAO_CONTATAR`;
- logs sanitizados;
- autenticação e autorização;
- shadow mode;
- gates sintéticos em PostgreSQL;
- testes de mensageria manual assistida sem envio real;
- estrutura para WhatsApp oficial e IA documentada;
- backup, restore, rollback e smoke documentados;
- perfis de implantação Supabase/Render e Oracle VPS.

Essas capacidades ainda não significam que os serviços futuros estão prontos para uso comercial. Elas demonstram que a arquitetura está sendo construída para suportar progressivamente descoberta, campanhas, qualificação, roteamento, mensageria e governança.

## 10. Capacidades em desenvolvimento ou previstas

### Fundação em desenvolvimento

- piloto real manual;
- ambiente efetivo de homologação;
- confirmação das flags fail-closed;
- qualificação privada de leads;
- políticas de canais e supressões;
- mensageria manual assistida;
- evidências e métricas de qualidade;
- operação controlada com revisão humana.

### Próximas capacidades

- adaptador Google Places oficial;
- cobertura territorial ampliada;
- verificação externa de presença digital;
- score de presença digital explicável;
- interface para configuração de oferta e público;
- questionários por vertical;
- classificação de respostas com IA em shadow mode;
- handoff para vendedor;
- painel de campanhas e oportunidades;
- integração oficial de e-mail;
- WhatsApp Business Platform;
- webhooks assinados;
- integração com CRMs;
- múltiplos clientes com isolamento por tenant.

### Capacidades posteriores

- agentes conversacionais por vertical;
- roteamento inteligente;
- agenda e visitas;
- cobrança por uso e oportunidade qualificada;
- white-label;
- marketplace de pacotes por nicho;
- aprendizado com resultados comerciais;
- operação nacional distribuída;
- APIs para parceiros e grandes empresas.

## 11. Verticais futuras prioritárias

A arquitetura deverá ser horizontal, mas cada lançamento comercial deverá ocorrer por vertical.

Verticais com potencial:

- imobiliárias e incorporadoras;
- veículos;
- energia solar;
- software e serviços B2B;
- equipamentos industriais;
- construção e reformas;
- segurança eletrônica;
- franquias;
- educação de alto valor;
- telecomunicações empresariais;
- consultorias;
- serviços financeiros empresariais, após controles regulatórios específicos;
- saúde e outros segmentos sensíveis, somente após governança especializada.

Cada vertical deverá possuir:

- definição do produto;
- público ideal;
- fontes permitidas;
- sinais de aderência;
- perguntas;
- score;
- exclusões;
- regras de canal;
- critérios de handoff;
- métricas de sucesso;
- riscos e controles específicos.

## 12. Métricas de qualidade

O produto deverá evitar métricas de vaidade e separar descoberta, contato, resposta e venda.

### Descoberta

- candidatos por consulta;
- candidatos únicos;
- cobertura por região;
- duplicidades;
- identidade confirmada;
- atividade confirmada;
- custo por candidato analisado.

### Qualificação

- oportunidade confirmada;
- falso positivo;
- falso negativo;
- canal válido;
- score médio;
- divergência entre IA e humano;
- tempo de revisão.

### Comunicação

- contatos aprovados;
- mensagens efetivamente enviadas;
- entregas confirmadas;
- respostas;
- respostas positivas;
- respostas negativas;
- opt-outs;
- reclamações;
- handoffs aceitos.

### Resultado comercial

- reuniões;
- visitas;
- propostas;
- vendas;
- receita atribuída;
- tempo até atendimento humano;
- taxa de conversão por vertical;
- qualidade percebida pelo cliente.

## 13. Princípios permanentes

- qualidade antes de volume;
- evidência antes de classificação;
- canais oficiais antes de escala;
- `NOT_SENT` enquanto o gate não estiver completo;
- opt-out imediato;
- `DO_NOT_CONTACT` e `NAO_CONTATAR` prioritários;
- IA assiste, mas não autoriza operações sensíveis sozinha;
- revisão humana para baixa confiança ou alto impacto;
- nenhuma inferência tratada como fato;
- nenhuma promessa comercial sem base;
- nenhuma PII em issue, PR, log ou documentação pública;
- nenhuma expansão de volume sem métricas de qualidade;
- nenhuma configuração parcial autoriza envio;
- fail-closed como padrão.

## 14. Critério de sucesso da visão

A visão será considerada validada quando a plataforma demonstrar, em pelo menos uma vertical:

1. descoberta ou recebimento reproduzível de oportunidades;
2. identidade e aderência verificáveis;
3. classificação explicável;
4. integração oficial de canal;
5. supressões e opt-out confiáveis;
6. redução comprovada de ruído para a equipe comercial;
7. handoff aceito pelo vendedor;
8. reuniões, visitas ou propostas atribuíveis;
9. operação sem contato indevido;
10. receita recorrente e retenção inicial.

## 15. Declaração final

O Lead Finder Brasil está sendo construído para transformar:

```text
Produto disponível + público ideal + descoberta + conversa inicial
+ qualificação por IA + segurança + handoff humano
```

em oportunidades comerciais mais acertadas.

A venda de landing pages é o primeiro laboratório prático. O objetivo futuro é permitir que empresas de diferentes setores configurem suas ofertas, encontrem ou recebam potenciais clientes, filtrem o interesse e entreguem aos seus vendedores somente as conversas que merecem continuidade humana.
