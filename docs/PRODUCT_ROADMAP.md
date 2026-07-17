# Lead Finder — Roadmap Estratégico de Produto

> Da descoberta de empresas sem presença digital a uma plataforma nacional de crescimento, relacionamento e operação comercial.

## 1. Visão

O Lead Finder nasce com um objetivo simples e verificável: localizar empresas com indícios de ausência de site, validar a oportunidade, organizar a prospecção e apoiar a oferta de landing pages e sites institucionais.

A visão de longo prazo é evoluir esse núcleo para uma plataforma modular de crescimento empresarial capaz de atender, com níveis progressivos de complexidade, desde o comerciante local que precisa divulgar seu negócio até organizações nacionais e internacionais com requisitos de governança, integração, segurança, escala e conformidade.

A plataforma não deve prometer atender literalmente todas as necessidades de todas as empresas. O objetivo estratégico é cobrir aproximadamente 90% das demandas recorrentes de aquisição, relacionamento, comunicação, operação comercial e presença digital por meio de módulos próprios, integrações oficiais e extensibilidade.

## 2. Tese do produto

A maioria das empresas não precisa inicialmente de mais ferramentas isoladas. Precisa de um caminho integrado:

```text
Ser descoberta -> construir presença digital -> captar contatos -> organizar clientes
-> comunicar com consentimento -> vender -> atender -> medir -> crescer
```

O Lead Finder pode ocupar essa jornada em camadas:

1. **Descobrir oportunidades:** identificar empresas, segmentos e regiões com demanda provável.
2. **Qualificar com segurança:** validar dados, origem, consentimento, bloqueios e adequação.
3. **Criar presença digital:** landing pages, sites, formulários, catálogos e canais de contato.
4. **Ativar relacionamento:** campanhas, WhatsApp oficial, e-mail, SMS e notificações.
5. **Organizar vendas:** CRM, oportunidades, propostas, contratos e pagamentos.
6. **Automatizar operações:** jornadas, tarefas, integrações, agentes e workflows.
7. **Gerar inteligência:** métricas, previsão, segmentação e recomendações.
8. **Governar em escala:** identidade, auditoria, privacidade, segurança e compliance.

## 3. Princípios permanentes

Toda evolução do produto deve respeitar estes princípios:

- **Consentimento e legitimidade antes de escala.** Envio em massa não significa envio indiscriminado.
- **Fail-closed por padrão.** Ausência de configuração segura deve bloquear operações sensíveis.
- **Humano no controle.** Primeiro contato, conteúdo sensível, opt-out e decisões de alto impacto exigem supervisão adequada.
- **Idempotência e auditabilidade.** Reinícios, retries e concorrência não podem duplicar efeitos.
- **Módulos independentes.** Pequenos clientes usam somente o necessário; grandes clientes combinam capacidades.
- **APIs oficiais.** WhatsApp, e-mail, pagamentos e demais canais devem usar integrações autorizadas.
- **Privacidade por design.** Coletar o mínimo necessário, registrar origem, limitar retenção e facilitar exclusão.
- **Brasil primeiro, internacionalizável desde a arquitetura.** Idioma, moeda, fuso, impostos e regras locais devem ser desacoplados.
- **Evidência antes de expansão.** Cada fase exige métricas, aprendizado real e critérios objetivos de avanço.
- **Produto simples na superfície, robusto no núcleo.** A complexidade técnica não deve ser transferida ao usuário.

## 4. Segmentos atendidos

### 4.1 Microempreendedores e comércio local

Necessidades predominantes:

- presença digital rápida;
- página de apresentação;
- catálogo de produtos ou serviços;
- botão de WhatsApp;
- captura de contatos;
- campanhas simples para clientes consentidos;
- lembretes e ofertas;
- baixo custo e configuração assistida.

### 4.2 Pequenas empresas

Necessidades predominantes:

- site completo;
- CRM simples;
- funil de vendas;
- campanhas segmentadas;
- propostas e contratos;
- automações de follow-up;
- relatórios básicos;
- integração com agenda, pagamentos e atendimento.

### 4.3 Empresas médias

Necessidades predominantes:

- múltiplas equipes e unidades;
- permissões por função;
- pipelines distintos;
- integrações com ERP e ferramentas existentes;
- SLA, auditoria, dashboards e atribuição;
- automações avançadas;
- governança de dados e consentimento.

### 4.4 Grandes empresas e enterprise

Necessidades predominantes:

- SSO e gestão centralizada de identidade;
- segregação de ambientes e tenants;
- políticas corporativas;
- trilha de auditoria imutável;
- integrações em larga escala;
- observabilidade, disponibilidade e recuperação;
- residência e classificação de dados;
- contratos, SLAs e suporte dedicado;
- controles de risco e compliance.

### 4.5 Operação internacional futura

Necessidades predominantes:

- localização de idioma, moeda, fuso e formatos;
- regras de consentimento por jurisdição;
- canais e providers regionais;
- residência de dados;
- cobrança internacional;
- suporte multilíngue;
- governança global com autonomia local.

## 5. Arquitetura de portfólio futura

A visão de produto pode ser organizada em nove linhas modulares:

| Linha | Propósito |
|---|---|
| **Discover** | descoberta, pesquisa, enriquecimento e inteligência territorial |
| **Presence** | criação e gestão de sites, landing pages, catálogos e formulários |
| **CRM** | leads, clientes, oportunidades, tarefas, propostas e histórico |
| **Engage** | campanhas consentidas, jornadas e comunicação multicanal |
| **Service** | atendimento, caixa de entrada, tickets, agenda e pós-venda |
| **Commerce** | catálogo, orçamento, contrato, pagamento e recorrência |
| **Automation** | workflows, integrações, webhooks, filas e agentes assistidos |
| **Intelligence** | métricas, segmentação, previsão, recomendação e IA governada |
| **Trust** | identidade, segurança, privacidade, auditoria e compliance |

## 6. Roadmap por horizonte

Os horizontes abaixo representam dependência e maturidade, não datas rígidas. A expansão deve ocorrer somente após os critérios de saída de cada etapa.

---

## Horizonte 0 — Origem e validação da tese

**Objetivo:** provar que empresas com presença digital insuficiente podem ser identificadas, qualificadas e abordadas de forma segura para oferta de sites e landing pages.

### Capacidades

- descoberta de empresas por região e categoria;
- normalização e deduplicação;
- confirmação humana de ausência de site;
- contatos com origem e confiança;
- CRM e histórico comercial;
- campanha exclusivamente simulada;
- abordagem manual fora do sistema;
- resultados e métricas auditáveis;
- bloqueios, opt-out e `NAO_CONTATAR`;
- shadow mode e egress desabilitado por padrão.

### Resultado esperado

Um primeiro ciclo controlado de 20 a 30 leads que revele:

- qualidade real da descoberta;
- disponibilidade de contatos válidos;
- taxa de resposta;
- interesse em sites ou landing pages;
- objeções de preço, prazo e confiança;
- esforço operacional por oportunidade.

### Critério de saída

- piloto reproduzível;
- nenhum envio automático indevido;
- nenhuma duplicidade;
- todos os bloqueios respeitados;
- evidências por SHA e período;
- decisão fundamentada de continuar, ajustar ou abandonar a tese.

---

## Horizonte 1 — Produto vendável para presença digital

**Objetivo:** transformar a prospecção validada em uma operação completa de venda e entrega de sites e landing pages.

### Capacidades

- catálogo de pacotes e serviços;
- briefing digital estruturado;
- proposta versionada em PDF e link compartilhável;
- assinatura ou aceite eletrônico;
- etapas de produção e aprovação;
- templates de landing pages e sites institucionais;
- formulários, domínio, analytics e integração com WhatsApp;
- cobrança inicial, parcelamento e recorrência de manutenção;
- portal simples do cliente;
- checklist de publicação e pós-entrega;
- planos de hospedagem, manutenção e suporte.

### Produtos comerciais sugeridos

- **Presença Essencial:** página única, WhatsApp, localização e serviços.
- **Landing de Conversão:** campanha, formulário, pixel e analytics.
- **Site Institucional:** páginas, catálogo, SEO básico e conteúdo.
- **Presença Gerenciada:** site, hospedagem, atualizações e suporte mensal.
- **Crescimento Local:** presença digital mais campanhas consentidas e CRM básico.

### Critério de saída

- pelo menos um ciclo de venda e entrega concluído;
- margem e prazo medidos;
- satisfação do cliente registrada;
- receita recorrente inicial ou manutenção contratada;
- processo executável sem depender integralmente do fundador.

---

## Horizonte 2 — CRM e comunicação para micro e pequenas empresas

**Objetivo:** permitir que pequenos negócios organizem clientes e façam comunicações legítimas sem precisar operar ferramentas complexas.

### Capacidades

- importação assistida de contatos com comprovação de origem;
- segmentação por interesse, compra, localização e relacionamento;
- e-mail transacional e campanhas consentidas;
- WhatsApp Business Platform oficial;
- SMS por provider autorizado;
- templates aprovados e versionados;
- agendamento, limites, quiet hours e frequência máxima;
- opt-in, opt-out, supressão e preferências por canal;
- calendário de campanhas;
- automações simples de aniversário, retorno, renovação e promoção;
- caixa de entrada unificada;
- relatórios de entrega, resposta e conversão.

### Regra fundamental para envio em massa

A plataforma deve oferecer **comunicação em escala com consentimento**, não spam. Toda campanha deve exigir:

- base legítima e origem registrada;
- finalidade compatível;
- identidade clara do remetente;
- mecanismo de descadastro;
- limites de frequência;
- supressão imediata após opt-out;
- rastreabilidade de conteúdo, operador e público;
- compatibilidade com LGPD e políticas dos providers.

### Critério de saída

- campanhas reais somente com contatos próprios de teste e depois bases consentidas;
- taxa de reclamação dentro dos limites dos providers;
- opt-out comprovadamente imediato;
- custos por canal conhecidos;
- retenção de pequenos clientes demonstrada.

---

## Horizonte 3 — Plataforma de crescimento para pequenas empresas

**Objetivo:** conectar presença digital, marketing, vendas, atendimento e cobrança em uma experiência simples.

### Capacidades

- construtor orientado por templates;
- formulários e captura omnicanal;
- lead routing e distribuição por responsável;
- múltiplos funis;
- agenda e lembretes;
- propostas, contratos e pagamentos;
- automações condicionais;
- integração com Google Business Profile, redes sociais e analytics;
- catálogo, orçamento e pedidos simples;
- portal do cliente;
- indicadores de aquisição, conversão, receita e retenção;
- recomendações assistidas para próxima ação.

### Experiência-alvo

Um comerciante deve conseguir:

1. publicar uma página;
2. importar clientes consentidos;
3. criar uma campanha;
4. receber respostas;
5. registrar vendas;
6. acompanhar resultados;

sem conhecer termos técnicos de infraestrutura, APIs ou filas.

### Critério de saída

- onboarding autônomo;
- ativação inicial mensurável;
- baixa necessidade de suporte manual;
- planos pagos claros;
- retenção e expansão de uso por módulo.

---

## Horizonte 4 — Marketplace, parceiros e operação multiempresa

**Objetivo:** permitir que agências, consultorias, franquias e integradores operem múltiplos clientes com governança.

### Capacidades

- multi-tenant com isolamento explícito;
- contas matriz, filial e parceiro;
- white-label controlado;
- gestão de carteiras de clientes;
- templates compartilháveis;
- billing por uso, conta e módulo;
- marketplace de templates, automações e integrações;
- programa de parceiros;
- provisionamento automatizado;
- permissões delegadas;
- auditoria por tenant;
- limites e quotas configuráveis.

### Critério de saída

- isolamento de tenants validado por testes de segurança;
- billing reconciliável;
- parceiro consegue implantar sem acesso indevido;
- suporte e observabilidade por conta;
- política de marketplace e revisão de integrações.

---

## Horizonte 5 — Mid-market nacional

**Objetivo:** atender empresas médias com equipes, unidades e processos mais complexos.

### Capacidades

- RBAC e ABAC avançados;
- equipes, territórios, unidades e hierarquias;
- aprovação em múltiplos níveis;
- pipelines e campos configuráveis;
- SLAs comerciais e de atendimento;
- webhooks assinados;
- API pública versionada;
- conectores para ERP, e-commerce, atendimento e BI;
- importações em lote com reconciliação;
- data quality e deduplicação corporativa;
- dashboards por unidade, canal e equipe;
- sandbox e ambientes separados;
- políticas de retenção configuráveis;
- trilhas de auditoria exportáveis.

### Critério de saída

- disponibilidade e capacidade medidas;
- recuperação testada;
- integrações críticas observáveis;
- governança de mudanças;
- contrato de suporte e incidentes;
- clientes com múltiplas equipes em uso real.

---

## Horizonte 6 — Enterprise nacional

**Objetivo:** tornar a plataforma elegível para organizações com requisitos corporativos de segurança, escala, procurement e compliance.

### Capacidades

- SSO via SAML/OIDC;
- SCIM para ciclo de vida de usuários;
- MFA e políticas de sessão;
- segregação de funções;
- chaves gerenciadas e rotação de segredos;
- criptografia e classificação de dados;
- logs imutáveis e integração com SIEM;
- auditoria administrativa completa;
- disaster recovery com RPO/RTO definidos;
- alta disponibilidade e escalabilidade horizontal;
- rate limiting por tenant e canal;
- feature flags e rollout gradual;
- data residency quando necessário;
- DPA, subprocessadores e documentação de privacidade;
- gestão de vulnerabilidades e resposta a incidentes;
- SLAs, suporte dedicado e success management;
- ambientes privados, conectividade restrita ou implantação dedicada quando economicamente justificável.

### Certificações e maturidade possíveis

A adoção deve ser orientada por demanda comercial, não por selo antecipado:

- programa estruturado de segurança;
- práticas alinhadas a ISO 27001;
- controles auditáveis compatíveis com SOC 2;
- gestão de privacidade alinhada à LGPD;
- avaliações independentes e testes de intrusão;
- políticas formais de continuidade, incidentes e fornecedores.

### Critério de saída

- security review independente;
- SLOs e SLAs cumpridos;
- DR comprovado;
- processos de suporte e incidente exercitados;
- documentação suficiente para procurement;
- cliente enterprise operando com contrato e governança.

---

## Horizonte 7 — Inteligência e IA governada

**Objetivo:** aumentar produtividade e qualidade de decisão sem retirar controle, explicabilidade ou responsabilidade dos usuários.

### Capacidades

- sugestão de segmentação;
- priorização de leads com fatores explicáveis;
- resumo de interações;
- recomendação de próxima ação;
- assistência na criação de páginas, mensagens e propostas;
- classificação de respostas e objeções;
- previsão de risco e oportunidade;
- detecção de anomalias em campanhas;
- copiloto operacional por perfil;
- busca semântica em histórico autorizado;
- avaliação contínua de qualidade, custo e segurança dos modelos;
- escolha entre modelos locais, privados ou providers externos;
- políticas de uso, aprovação e retenção de prompts e respostas.

### Restrições obrigatórias

- IA não deve inventar consentimento, dados ou resultado comercial;
- decisões de bloqueio, opt-out e contato não podem ser ignoradas;
- conteúdo de alto impacto exige revisão apropriada;
- dados de tenants não podem contaminar outros tenants;
- ações devem manter trilha de auditoria;
- modelo e versão devem ser rastreáveis quando afetarem operações.

### Critério de saída

- avaliações com datasets representativos;
- qualidade superior ao baseline manual em tarefas específicas;
- custos previsíveis;
- possibilidade de desativação;
- ausência de vazamento entre tenants;
- documentação de limitações e supervisão.

---

## Horizonte 8 — Ecossistema nacional de crescimento empresarial

**Objetivo:** consolidar uma plataforma conectável que cubra a maior parte das operações recorrentes de crescimento e relacionamento das empresas brasileiras.

### Capacidades

- hub de integrações brasileiras;
- conectores contábeis, fiscais, bancários e comerciais por parceiros especializados;
- marketplace de agências e prestadores;
- benchmarks anonimizados e agregados;
- jornadas por setor: varejo, serviços, saúde, educação, imobiliário, indústria e franquias;
- módulos verticais sem fragmentar o núcleo;
- data platform para BI e ativação;
- eventos e APIs para parceiros;
- governança de extensões;
- faturamento e revenue sharing;
- rede de implementação e suporte certificada.

### Limite estratégico

O Lead Finder não deve tentar substituir ERPs, bancos, plataformas fiscais ou sistemas clínicos especializados. Deve integrar-se a eles e concentrar-se em descoberta, presença digital, relacionamento, vendas, automação e inteligência.

### Critério de saída

- ecossistema economicamente sustentável;
- integrações críticas mantidas por contratos e SLAs;
- parceiros ativos;
- expansão por módulos comprovada;
- governança que evite dependência excessiva de uma única integração.

---

## Horizonte 9 — Internacionalização

**Objetivo:** expandir a plataforma para mercados selecionados somente após product-market fit e maturidade operacional no Brasil.

### Sequência recomendada

1. arquitetura preparada para localização;
2. inglês e espanhol;
3. operação piloto em um único país adicional;
4. canais e providers locais;
5. adequação jurídica e tributária;
6. residência e transferência internacional de dados;
7. suporte regional;
8. expansão gradual por similaridade de mercado.

### Capacidades

- i18n e l10n completas;
- moedas e impostos configuráveis;
- fusos e calendários locais;
- políticas de consentimento por região;
- provedores de comunicação alternáveis;
- cobrança internacional;
- contratos e documentação localizados;
- roteamento regional de dados;
- suporte multilíngue;
- governança global e administração regional.

### Critério de saída

- unit economics positivos no Brasil;
- operação nacional independente do fundador;
- segurança e suporte maduros;
- parceiro ou demanda comprovada no país-alvo;
- análise jurídica e financeira concluída;
- piloto internacional com escopo limitado.

## 7. Marcos de versão sugeridos

| Versão | Nome | Resultado principal |
|---|---|---|
| **0.1** | Discovery Core | descoberta, normalização e deduplicação |
| **0.2** | Qualification | validação, contatos, evidências e bloqueios |
| **0.3** | CRM Core | pipeline, tarefas, timeline e concorrência |
| **0.4** | Campaign Simulation | templates, campanhas, outbox e simulação segura |
| **0.5** | Controlled Pilot | piloto interno persistente e auditável |
| **0.6** | Presence Sales | catálogo, proposta, contrato e entrega de sites |
| **0.7** | Small Business Engage | campanhas consentidas e comunicação oficial |
| **0.8** | Growth Workspace | presença, CRM, agenda, automação e métricas integradas |
| **0.9** | Partner Platform | multiempresa, white-label e marketplace inicial |
| **1.0** | Brazilian SMB Platform | produto estável para micro e pequenas empresas |
| **2.0** | Mid-Market | equipes, unidades, API pública e integrações corporativas |
| **3.0** | Enterprise | SSO, compliance, HA, DR e governança avançada |
| **4.0** | Intelligent Platform | IA governada, previsão e copilotos operacionais |
| **5.0** | Ecosystem | marketplace e ecossistema nacional de parceiros |
| **6.0** | International | operação multilíngue e expansão regional |

Os números representam maturidade do produto, não compromisso de calendário. Uma versão só deve ser declarada concluída após testes, evidências e critérios de saída.

## 8. Capacidades transversais

Estas frentes não são fases isoladas; evoluem continuamente.

### Segurança

- threat modeling por mudança relevante;
- autenticação e autorização de menor privilégio;
- gestão de segredos;
- hardening de infraestrutura;
- análise de dependências;
- proteção de supply chain;
- testes de abuso, concorrência e isolamento;
- resposta a incidentes.

### Privacidade e conformidade

- inventário e classificação de dados;
- origem e base legal;
- consentimento e preferências;
- retenção e exclusão;
- atendimento a direitos do titular;
- avaliação de subprocessadores;
- privacy by default;
- relatórios de impacto quando necessários.

### Confiabilidade

- idempotência;
- transactional outbox;
- retries limitados;
- dead-letter auditável;
- locks ordenados;
- migrações repetíveis;
- rollback;
- backup e restore;
- observabilidade e alertas;
- testes de carga e caos progressivos.

### Experiência do usuário

- onboarding orientado a objetivos;
- linguagem simples;
- acessibilidade;
- responsividade;
- design system;
- autosserviço com proteção;
- ajuda contextual;
- explicação de bloqueios e recomendações.

### Modelo comercial

- plano gratuito ou avaliação controlada;
- planos por capacidade e volume;
- add-ons por canal e uso;
- serviços de implantação;
- marketplace e revenue share;
- contratos anuais para empresas médias;
- pricing enterprise por escopo, SLA e ambiente.

## 9. Métricas norteadoras

### Valor ao cliente

- tempo até primeira página publicada;
- tempo até primeiro lead qualificado;
- tempo até primeira campanha consentida;
- taxa de ativação;
- oportunidades e receita geradas;
- horas operacionais economizadas;
- satisfação e retenção.

### Qualidade comercial

- taxa de contato válido;
- taxa de resposta;
- taxa de interesse;
- taxa de proposta;
- taxa de fechamento;
- ticket médio;
- margem;
- expansão por módulo;
- churn.

### Confiança

- duplicidades evitadas;
- opt-outs respeitados;
- incidentes de privacidade;
- taxa de reclamação;
- disponibilidade;
- sucesso de backup e restore;
- tempo de recuperação;
- falhas por integração.

### Eficiência da plataforma

- custo por tenant;
- custo por mensagem;
- custo por automação;
- latência;
- throughput;
- utilização de filas;
- taxa de retry e dead-letter;
- custo e qualidade de IA.

## 10. Gates de investimento e expansão

Antes de aumentar o escopo, a etapa anterior deve apresentar evidência.

| Decisão | Evidência mínima |
|---|---|
| automatizar contato | piloto manual validado, consentimento e controles de canal |
| lançar plano pago | cliente usando, valor percebido e custo de suporte medido |
| adicionar novo canal | provider oficial, opt-out, custos e observabilidade |
| criar multi-tenant | isolamento testado e billing definido |
| entrar em mid-market | equipes reais, integrações e suporte estruturado |
| entrar em enterprise | identidade, auditoria, DR, SLA e segurança independente |
| introduzir IA autônoma | avaliação, supervisão, rollback e limites de ação |
| internacionalizar | PMF nacional, operação estável e demanda no país-alvo |

## 11. O que não fazer prematuramente

- habilitar disparo em massa antes de validar consentimento e reputação;
- construir dezenas de integrações sem clientes pedindo por elas;
- perseguir certificações caras antes da necessidade comercial;
- misturar dados entre clientes para acelerar desenvolvimento;
- adicionar IA sem baseline, métricas e supervisão;
- prometer cobertura enterprise sem suporte, SLA e DR;
- internacionalizar antes de resolver retenção e unit economics no Brasil;
- substituir sistemas especializados quando uma integração é suficiente;
- transformar o produto em um conjunto incoerente de funcionalidades.

## 12. Próximos passos concretos

1. concluir a homologação isolada do piloto;
2. validar backup, restore, restart e kill switch;
3. executar o primeiro lote controlado de 20 a 30 leads;
4. medir demanda por sites e landing pages;
5. concluir o módulo de propostas e catálogo de serviços;
6. entregar o primeiro projeto pelo fluxo completo;
7. validar manutenção recorrente;
8. somente depois iniciar comunicação oficial para bases consentidas;
9. transformar aprendizados reais em backlog priorizado;
10. revisar este roadmap a cada marco relevante.

## 13. Declaração de futuro

O Lead Finder pode começar ajudando uma única empresa local a ser encontrada na internet. Pode evoluir para ajudar milhares de negócios a construir presença, organizar clientes, comunicar com responsabilidade e crescer com dados.

O objetivo não é apenas enviar mensagens, criar páginas ou registrar vendas. É construir uma infraestrutura confiável para transformar oportunidade em relacionamento e relacionamento em crescimento sustentável — primeiro no Brasil, depois onde houver demanda real e capacidade operacional para servir com qualidade.
