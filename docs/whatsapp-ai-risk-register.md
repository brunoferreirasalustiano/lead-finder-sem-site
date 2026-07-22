# Registro de riscos — WhatsApp e IA

## Objetivo

Registrar os principais riscos da fundação de mensageria, do envio manual assistido, da futura WhatsApp Cloud API e da IA em shadow mode. Este documento não habilita provider, envio, webhook ou chave externa.

## Escala

- impacto: `BAIXO`, `MEDIO`, `ALTO`, `CRITICO`;
- probabilidade: `BAIXA`, `MEDIA`, `ALTA`;
- estado: `OPEN`, `CONTROLLED`, `BLOCKED`, `ACCEPTED`, `CLOSED`.

Nenhum risco `ALTO` ou `CRITICO` pode ser aceito implicitamente.

## Riscos e controles

| ID | Risco | Impacto | Controle obrigatório | Evidência de saída | Estado inicial |
|---|---|---|---|---|---|
| WA-01 | contato após opt-out ou `NAO_CONTATAR` | CRITICO | elegibilidade transacional, reconciliação pós-restore, testes por canal e bloqueio permanente | PR #69 aprovada e teste end-to-end | BLOCKED |
| WA-02 | envio duplicado por replay ou retry | CRITICO | chave de idempotência, transições monotônicas e replay idêntico sem duplicação | testes de replay e conflito | OPEN |
| WA-03 | contato com número incorreto ou de terceiro | ALTO | normalização E.164, associação contato-lead e revisão humana | testes de integridade e resultado `INVALID_CONTACT` | OPEN |
| WA-04 | automação não oficial causar bloqueio do número | ALTO | proibir WhatsApp Web, Baileys, Evolution API e sessão por QR | revisão de dependências e arquitetura | CONTROLLED |
| WA-05 | abertura de link tratada como mensagem enviada | ALTO | estados separados `PREPARED`, `OPENED` e `CONTACTED` | testes de transição e contrato da API | OPEN |
| WA-06 | token Meta exposto | CRITICO | secrets externos, rotação e proibição em Git/logs | secret scan e checklist de ambiente | OPEN |
| WA-07 | webhook falsificado | CRITICO | validar assinatura sobre bytes originais antes de parsear | testes com assinatura válida e inválida | OPEN |
| WA-08 | eventos de entrega duplicados ou fora de ordem | ALTO | deduplicação por ID do provider e reconciliação monotônica | testes de replay e ordenação | OPEN |
| WA-09 | retry em erro permanente gerar contato excessivo | ALTO | classificação tipada; retry apenas em 429/5xx transitórios e com limite | testes de classificação e max attempts | OPEN |
| WA-10 | provider ativado por configuração parcial | CRITICO | múltiplos gates simultâneos, kill switch e fail-closed | testes de matriz de flags | CONTROLLED |
| AI-01 | IA inventar alegação comercial | ALTO | `unsupportedClaims`, schema e revisão humana obrigatória | testes com alegações não suportadas | OPEN |
| AI-02 | IA autorizar envio | CRITICO | contrato sem capacidade de envio e separação de permissões | revisão arquitetural e teste negativo | CONTROLLED |
| AI-03 | PII excessiva enviada ao modelo | ALTO | minimização, allowlist de campos e sanitização | testes de prompt e logs | OPEN |
| AI-04 | saída inválida ou incompleta | MEDIO | Structured Outputs/schema; fallback `REVISAO_HUMANA` | testes de saída inválida | OPEN |
| AI-05 | indisponibilidade da IA bloquear operação | MEDIO | timeout, circuit breaker e fluxo manual independente | testes de timeout e provider disabled | OPEN |
| AI-06 | custo inesperado | MEDIO | orçamento diário, limite de tamanho e métricas sem PII | testes de budget gate | OPEN |
| AI-07 | retenção externa não compreendida | ALTO | `store=false`, política documentada e revisão contratual | checklist de configuração | OPEN |
| SEC-01 | PII em logs, erros ou artifacts | CRITICO | logs sanitizados, captura em testes e allowlist de campos | testes que falham com telefone/mensagem integral | OPEN |
| SEC-02 | credencial em commit ou histórico de branch | CRITICO | placeholders, secret scanning e reconstrução de branch quando necessário | revisão de histórico ativo | CONTROLLED |
| OPS-01 | restore reativar jobs suprimidos | CRITICO | reconciliação determinística antes de liberar serviços | PR #69 e evidência PostgreSQL | BLOCKED |
| OPS-02 | kill switch impedir startup sem procedimento claro | MEDIO | separar estado de configuração e procedimento operacional documentado | testes de startup e engage/release | CONTROLLED |
| OPS-03 | estado manual sobrescrito silenciosamente | ALTO | append-only ou transições validadas e conflito de idempotência | testes de transição | OPEN |
| OPS-04 | ampliação prematura do lote | ALTO | lote inicial de até 5 e aprovação humana antes de 20–30 | relatório do primeiro lote | OPEN |

## Gates por fase

### Fundação e manual assistido

Obrigatórios antes de concluir as Fases A e B:

- WA-01 controlado;
- WA-02, WA-03 e WA-05 com testes;
- AI-02 controlado por arquitetura;
- SEC-01 com testes automatizados;
- OPS-01 fechado pela PR #69;
- OPS-03 com transições e idempotência comprovadas.

### IA em shadow mode

Obrigatórios antes de ativar `AI_PROVIDER=openai`:

- AI-01, AI-03, AI-04, AI-05, AI-06 e AI-07 controlados;
- nenhum envio dependente da IA;
- chave fora do Git;
- saída sempre validada;
- fallback humano testado.

### WhatsApp Cloud API sandbox

Obrigatórios antes de configurar provider real:

- WA-06, WA-07, WA-08, WA-09 e WA-10 controlados;
- allowlist de números de teste;
- template aprovado;
- webhook HTTPS validado;
- nenhuma mensagem livre fora das regras da plataforma;
- evidência sanitizada.

### Piloto real

Obrigatórios antes de qualquer envio real:

- todos os riscos críticos em `CONTROLLED` ou `CLOSED`;
- nenhum risco alto em `BLOCKED`;
- kill switch comprovado;
- opt-out end-to-end;
- rollback testado;
- aprovação humana explícita;
- lote e limites definidos.

## Regra de atualização

Cada PR relacionada a WhatsApp, IA, consentimento, restore, outbox ou webhooks deve:

1. indicar os riscos afetados;
2. descrever novos controles;
3. adicionar ou atualizar testes;
4. registrar riscos residuais;
5. não promover estado sem evidência.