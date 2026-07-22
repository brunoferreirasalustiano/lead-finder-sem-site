# Evidências do ensaio sintético do primeiro lote manual

## Objetivo

Comprovar que a fundação de mensageria manual assistida executa o fluxo de preparação e registro sem efeito externo, usando exclusivamente dados sintéticos e PostgreSQL descartável.

Este documento não autoriza contato real. A execução real continua condicionada às issues #81, #85, #92 e #93 e à aprovação humana individual.

## Comandos que formam o gate

```bash
npm run build
npm run test:manual-messaging
npm run test:supabase-data-api-security
npm run test:integration
npm run test:pilot:restart
```

Na CI, as migrations são aplicadas duas vezes antes das suítes de integração. Os testes usam números, e-mails, empresas e IDs sintéticos.

## Matriz de cobertura

| Requisito do ensaio | Evidência automatizada | Estado |
|---|---|---|
| WhatsApp com opt-in explícito | `manual-messaging.integration.ts`: caso `01 WhatsApp with valid opt-in` | COBERTO |
| WhatsApp sem opt-in | caso `02 WhatsApp without opt-in rejected` | COBERTO |
| Fallback para e-mail empresarial revisado | caso `03 explicitly reviewed business Gmail is eligible` | COBERTO |
| Gmail sem revisão específica | caso `03a Gmail without contact review is blocked` | COBERTO |
| E-mail pessoal ou desconhecido | casos `03b` e `03d` | COBERTO |
| Domínio próprio não substitui revisão humana | casos `03c`, `03f` e `03g` | COBERTO |
| Origem ausente ou não suportada | casos `03e` e `03e.1` | COBERTO |
| Contato pertencente a outro lead | caso `05 contact from another lead` | COBERTO |
| Lead bloqueado, DNC e `NAO_CONTATAR` | casos `06`, `07`, `08` e `27a` | COBERTO |
| Revisão do lead não aprovada | caso `12 review not approved` | COBERTO |
| Piloto fora de `RUNNING` | caso `13 pilot outside RUNNING` | COBERTO |
| Contato inválido ou não verificado | casos `14` e `15` | COBERTO |
| Opt-out global | caso `09 global opt-out` | COBERTO |
| Opt-out por canal preserva o outro canal | casos `10` e `11` | COBERTO |
| Template não aprovado | caso `16 unapproved template` | COBERTO |
| Replay idempotente | caso `17 identical payload replay` | COBERTO |
| Mesma chave com payload diferente | caso `18 same key with different payload` | COBERTO |
| Concorrência de preparação | caso `19 concurrent calls` | COBERTO |
| Replay mantém contato persistido | caso `20 replay preserves the eligible persisted contact` | COBERTO |
| Invalidação posterior bloqueia replay | casos `20a` e `20b` | COBERTO |
| Outro principal não pode reutilizar a chave | casos `21` e `25a` | COBERTO |
| `PREPARED` não é envio | caso `22 PREPARED creates no sending event` | COBERTO |
| Confirmação exige `OPENED` | caso `22a confirmation before opening rejected` | COBERTO |
| `OPENED` não é envio | casos `23` e `24` | COBERTO |
| Replay da confirmação | caso `25 duplicate confirmation` | COBERTO |
| Abertura depois de estado terminal | caso `25b` | COBERTO |
| Chaves diferentes não duplicam estado terminal | caso `25c` | COBERTO |
| Confirmações contraditórias concorrentes | caso `25d` | COBERTO |
| Opt-out após preparação bloqueia replay e confirmação | caso `27` | COBERTO |
| Opt-out concorrente vence confirmação | caso `28` | COBERTO |
| Estado persiste após restart lógico | caso `29` | COBERTO |
| Snapshot não contém contato, mensagem ou URL | caso `29a` | COBERTO |
| PostgreSQL bloqueia transição inválida direta | caso `29b` | COBERTO |
| Zero tentativa, outbox e evento de provider | casos `30`, `31` e `32` | COBERTO |
| Zero rede por construção | caso `33` | COBERTO |
| Evidência desfavorável concorrente bloqueia replay | `manual-messaging-concurrency.integration.ts` | COBERTO |
| Evidência desfavorável concorrente bloqueia confirmação | `manual-messaging-concurrency.integration.ts` | COBERTO |
| Versões de evidência são serializadas | `manual-messaging-concurrency.integration.ts` | COBERTO |
| Data API permanece deny-all | `supabase-data-api-security.integration.ts` | COBERTO |
| ACL append-only permite apenas `SELECT, INSERT` | `manual-messaging-append-only-acl.integration.ts` | COBERTO |

## Invariantes comprovadas

1. Preparar ou abrir um link não representa envio.
2. O sistema não cria `campaign_attempts`, `campaign_outbox` ou `campaign_provider_events` no fluxo manual.
3. O ator é derivado do principal autenticado.
4. Replay usa o contato persistido e falha fechado quando a elegibilidade muda.
5. Opt-out, bloqueio global, `do_not_contact` e `NAO_CONTATAR` vencem.
6. WhatsApp exige autorização explícita; telefone público não é autorização.
7. E-mail exige evidência empresarial específica e decisão humana.
8. O snapshot append-only não contém telefone, e-mail, mensagem renderizada ou URL completa.
9. As tabelas novas permanecem RLS deny-all, sem grants para `PUBLIC`, `anon` ou `authenticated`.
10. Nenhum provider externo é chamado.

## Execução antes do primeiro lote

Antes de apresentar qualquer lead real para aprovação, repetir os gates no SHA exato de `main` que será usado na homologação. O resultado deve ser registrado sem dados pessoais.

Veredito esperado:

`FIRST_BATCH_SYNTHETIC_REHEARSAL_PASSED`
