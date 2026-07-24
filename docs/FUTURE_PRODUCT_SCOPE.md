# Lead Finder Brasil — Escopo Futuro do Produto

> **Natureza deste documento:** visão estratégica e escopo futuro do produto. Este arquivo não representa prontidão operacional e não autoriza deploy, coleta externa, envio, provider, webhook, egress ou contato real.
>
> **Estado atual:** partes relevantes da fundação técnica já estão implementadas ou em desenvolvimento no repositório. As integrações externas, a prospecção automática real, a qualificação conversacional por IA, a operação multiempresa e a meta de 60 mensagens por dia permanecem condicionadas aos gates técnicos, jurídicos, comerciais e operacionais documentados.

## 1. Visão do produto

O **Lead Finder Brasil** está sendo desenvolvido para evoluir de um laboratório de prospecção assistida para uma plataforma brasileira de inteligência comercial, capaz de:

1. receber um produto, serviço ou oportunidade comercial de um cliente;
2. configurar público-alvo, território, perfil ideal e critérios de exclusão;
3. localizar potenciais compradores ou contratantes em fontes permitidas;
4. validar identidade, atividade, origem dos dados e compatibilidade inicial;
5. iniciar abordagens controladas em canais oficialmente integrados;
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
- território nacional, região, estado, cidade ou raio;
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
- cidades, bairros, estados ou territórios de interesse;
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

### Abrangência comercial

A entrega de landing pages, sites institucionais e presença digital pode ser realizada remotamente. Por isso, a operação comercial futura dessa vertical não ficará restrita a Campinas ou a uma única região.

O Lead Finder Brasil poderá pesquisar e atender empresas em **todo o território brasileiro**, segmentando campanhas por:

- país;
- estado;
- região metropolitana;
- cidade;
- categoria de negócio;
- atividade econômica;
- tamanho da oportunidade;
- qualidade do canal;
- capacidade operacional disponível.

Campinas e proximidades permanecem apenas como recorte do primeiro piloto controlado, não como limite do mercado do produto.

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

### Estratégia de cobertura nacional

A busca ampliada deverá considerar:

- divisão do Brasil por estados, regiões metropolitanas, municípios e células geográficas;
- campanhas nacionais executadas em ondas controladas;
- alternância de cidades e nichos para evitar concentração excessiva;
- raio configurável para negócios com atendimento local;
- território livre para serviços entregues remotamente;
- categorias oficiais e sinônimos regionais;
- múltiplas consultas por atividade;
- paginação controlada;
- limite de custo por fonte;
- deduplicação nacional por identificador da fonte e identidade normalizada;
- detecção de filiais e unidades;
- registro da consulta que originou cada candidato;
- data de coleta e validade da evidência;
- amostragem para medir cobertura e falsos negativos;
- distribuição da fila conforme capacidade diária de análise e abordagem.

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

## 6. Meta operacional futura — 60 mensagens enviadas por dia

A meta comercial da Vertical Experimental 01 será evoluir até **60 mensagens efetivamente enviadas por dia**, em território brasileiro, para empresas que tenham passado pelos filtros definidos.

Essa meta representa:

- 60 mensagens com execução registrada como enviada pelo canal oficial;
- destinatários empresariais distintos e elegíveis;
- identidade e atividade validadas;
- oportunidade digital comprovada ou suficientemente sustentada;
- canal empresarial com origem registrada;
- ausência de opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR` ou bloqueio administrativo;
- template aprovado e versionado;
- respeito a limites, janelas, idempotência e frequência;
- possibilidade clara de recusa e interrupção;
- rastreabilidade por campanha, oferta, destinatário e resultado.

A meta de 60 não significa enviar para qualquer registro encontrado. Para entregar 60 mensagens elegíveis, o motor de descoberta deverá analisar um volume diário superior, removendo candidatos inválidos, duplicados, sem oportunidade, sem canal adequado ou bloqueados.

### Funil diário de capacidade

```text
Volume amplo de candidatos nacionais
  -> normalização e deduplicação
  -> validação de identidade e atividade
  -> verificação de presença digital
  -> classificação da oportunidade
  -> verificação da origem e qualidade do canal
  -> consulta de supressões e bloqueios
  -> aplicação dos limites da campanha
  -> revisão humana ou regra governada aprovada
  -> até 60 mensagens efetivamente enviadas no dia
```

O número de candidatos necessários será medido nos testes. Ele não será fixado por suposição, porque dependerá da taxa real de aprovação por nicho, região e fonte.

### Definição de mensagem enviada

Para a meta diária, uma mensagem somente contará como enviada quando:

- houver destinatário elegível;
- a reserva idempotente tiver sido concluída;
- o provider oficial confirmar a aceitação da tentativa;
- o evento estiver persistido de forma auditável;
- a mensagem não tiver sido cancelada, bloqueada ou mantida em `NOT_SENT`.

Registros apenas analisados, mensagens em rascunho, filas pendentes, simulações e tentativas bloqueadas não contam para a meta.

### Crescimento gradual da capacidade

#### Fase A — primeiro piloto

- lote pequeno e individual;
- operação manual;
- validação do canal e da mensagem;
- medição de falsos positivos;
- confirmação do opt-out;
- nenhuma meta de escala.

#### Fase B — capacidade inicial

- aumento gradual para aproximadamente 5 a 10 mensagens por dia;
- somente após ambiente e canal comprovados;
- revisão humana integral;
- acompanhamento de respostas, negativas, opt-outs e reclamações.

#### Fase C — operação assistida

- aumento para aproximadamente 15 a 30 mensagens por dia;
- segmentação por nicho e ondas nacionais;
- IA em classificação ou shadow mode conforme o gate aplicável;
- revisão por amostragem somente depois de precisão comprovada;
- kill switch e rollback testados.

#### Fase D — meta de 60 mensagens por dia

- canais oficiais estáveis;
- infraestrutura e observabilidade comprovadas;
- qualidade de dados mensurada;
- limites por remetente, tenant, nicho e campanha;
- supressões aplicadas antes de cada tentativa;
- classificação explicável;
- handoff humano;
- monitoramento contínuo de reputação, opt-out e reclamações;
- capacidade de reduzir ou interromper o volume automaticamente quando os indicadores ultrapassarem limites aprovados.

### Meta comercial associada

O objetivo de aumentar mensagens é ampliar oportunidades de:

- respostas positivas;
- autorização para apresentação de demonstrações;
- reuniões;
- propostas de landing pages;
- vendas de sites;
- contratos de hospedagem, manutenção ou serviços digitais.

O projeto deverá separar claramente:

- mensagens enviadas;
- mensagens entregues;
- respostas recebidas;
- respostas positivas;
- demonstrações autorizadas;
- propostas emitidas;
- vendas concluídas.

A meta de 60 mensagens não será tratada como meta de 60 propostas. A quantidade de propostas dependerá das respostas favoráveis e da qualificação comercial real.

## 7. Abordagem inicial para empresas sem site oficial confirmado

A primeira abordagem deverá ser curta, individual, contextual e sem alegar como fato algo que ainda pode estar incorreto.

### Proposta de mensagem inicial

> Olá, tudo bem? Encontrei sua empresa ao pesquisar por **[serviço] em [cidade/estado]** e não localizei um site oficial claramente vinculado ao negócio. Posso estar enganado, por isso faço esta confirmação antes de enviar qualquer material.
>
> Criamos páginas profissionais para ajudar empresas a apresentar seus serviços e serem encontradas com mais facilidade por futuros clientes. Uma landing page pode dar mais visibilidade ao seu negócio e criar um caminho direto para pedidos de orçamento e contato.
>
> Posso preparar uma demonstração sem compromisso para você avaliar?

### Versão curta

> Olá! Encontrei sua empresa ao pesquisar por **[serviço] em [cidade/estado]** e não localizei um site oficial claramente vinculado ao negócio. Criamos landing pages para apresentar seus serviços e facilitar o contato de novos clientes. Posso preparar uma demonstração sem compromisso?

### Princípios da abordagem

- confirmar antes de afirmar ausência de site;
- identificar remetente e finalidade;
- não enviar link no primeiro contato sem autorização;
- não usar pressão artificial;
- não prometer posicionamento garantido no Google;
- não alegar resultado futuro como certeza;
- registrar opt-out imediatamente;
- não insistir após negativa;
- limitar follow-ups conforme política aprovada;
- encaminhar dúvida ou conflito para revisão humana.

## 8. Módulos futuros do Lead Finder Brasil

### 8.1 Discover

Responsável por:

- fontes de descoberta;
- pesquisas nacionais e territoriais;
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

- encaminhamento por território;
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

Essas capacidades ainda não significam que os serviços futuros estão prontos para uso comercial. Elas demonstram que a arquitetura está sendo construída para suportar progressivamente descoberta, campanhas, qualificação, roteamento, mensageria, escala nacional e governança.

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
- cobertura territorial nacional;
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
- múltiplos clientes com isolamento por tenant;
- gestão de capacidade para até 60 mensagens diárias por operação aprovada.

### Capacidades posteriores

- agentes conversacionais por vertical;
- roteamento inteligente;
- agenda e visitas;
- cobrança por uso e oportunidade qualificada;
- white-label;
- marketplace de pacotes por nicho;
- aprendizado com resultados comerciais;
- operação nacional distribuída;
- APIs para parceiros e grandes empresas;
- escalabilidade de volume por tenant, canal e reputação.

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

## 12. Métricas de qualidade e escala

O produto deverá evitar métricas de vaidade e separar descoberta, contato, resposta, proposta e venda.

### Descoberta

- candidatos por consulta;
- candidatos únicos;
- cobertura por estado, cidade e nicho;
- duplicidades;
- identidade confirmada;
- atividade confirmada;
- custo por candidato analisado;
- candidatos necessários por mensagem elegível.

### Qualificação

- oportunidade confirmada;
- falso positivo;
- falso negativo;
- canal válido;
- score médio;
- divergência entre IA e humano;
- tempo de revisão.

### Comunicação

- mensagens elegíveis;
- mensagens efetivamente enviadas;
- entregas confirmadas;
- falhas por canal;
- respostas;
- respostas positivas;
- respostas negativas;
- opt-outs;
- reclamações;
- handoffs aceitos;
- utilização da capacidade diária;
- volume por estado, cidade, nicho e remetente.

### Resultado comercial

- demonstrações autorizadas;
- propostas emitidas;
- reuniões;
- visitas;
- vendas;
- receita atribuída;
- tempo até atendimento humano;
- taxa de conversão por vertical;
- qualidade percebida pelo cliente.

## 13. Princípios permanentes

- qualidade e elegibilidade antes do envio;
- evidência antes de classificação;
- canais oficiais antes de escala;
- cobertura nacional sem envio indiscriminado;
- `NOT_SENT` enquanto o gate atual não estiver completo;
- opt-out imediato;
- `DO_NOT_CONTACT` e `NAO_CONTATAR` prioritários;
- IA assiste, mas não autoriza operações sensíveis sozinha;
- revisão humana para baixa confiança ou alto impacto;
- nenhuma inferência tratada como fato;
- nenhuma promessa comercial sem base;
- nenhuma PII em issue, PR, log ou documentação pública;
- nenhuma expansão de volume sem métricas de qualidade e reputação;
- nenhuma configuração parcial autoriza envio;
- fail-closed como padrão;
- redução automática de volume diante de risco ou degradação;
- meta de 60 mensagens somente após progressão comprovada.

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
10. receita recorrente e retenção inicial;
11. capacidade nacional segmentada;
12. evolução segura até 60 mensagens efetivamente enviadas por dia.

## 15. Declaração final

O Lead Finder Brasil está sendo construído para transformar:

```text
Produto disponível + público ideal + descoberta nacional + conversa inicial
+ qualificação por IA + segurança + handoff humano
```

em oportunidades comerciais mais acertadas.

A venda de landing pages é o primeiro laboratório prático e poderá atender empresas em todo o Brasil. O objetivo futuro é permitir que empresas de diferentes setores configurem suas ofertas, encontrem ou recebam potenciais clientes, filtrem o interesse e entreguem aos seus vendedores somente as conversas que merecem continuidade humana.

Na Vertical Experimental 01, a meta futura é alcançar 60 mensagens efetivamente enviadas por dia, com qualidade, rastreabilidade, canais oficiais, supressões e aumento gradual baseado em evidência.