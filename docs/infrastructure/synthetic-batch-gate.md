# Gate sintético automatizado do batch

Este Gate reproduz, em PostgreSQL real e descartável, o caminho interno Supabase + Render sem acessar esses serviços. Ele instancia a API Fastify com `buildApp`, usa `app.inject`, autenticação exclusivamente sintética e o processador real em dry-run com `executionSource=supabase-render`, papel primário, limite diário 60 e lote 5. Nenhuma porta pública é aberta.

## Execução

O banco precisa estar vazio, ter todas as migrations aplicadas e ser descartável:

```bash
DATABASE_URL=postgresql://... npm run test:batch-gate
```

O job `integration` da CI provisiona PostgreSQL 16, aplica as migrations e executa o comando antes dos demais testes de integração. Não execute o Gate contra produção, homologação compartilhada, Supabase ou Render. Nunca use dados, tokens ou segredos reais.

## Estados verificados

A fixture atômica contém exatamente um lead, contato verificado, campanha ativa, versão aprovada, destinatário elegível, tentativa aprovada e outbox `ATTEMPT_CREATED`. Os três snapshots são objetos JSONB e todos os registros usam o marcador `SYNTHETIC_AUTOMATED_BATCH_GATE`. A elegibilidade temporal vem de `transaction_timestamp() - interval '1 second'` no PostgreSQL.

Antes da chamada existe uma única outbox pendente e reclamável, sem tentativa, execução, confirmação, alocação, provider event ou invocação. Depois da primeira chamada, o Gate exige HTTP 200, um item processado, outbox publicada com uma tentativa, claims limpos, uma execução, uma confirmação simulada, uma alocação, contador diário igual a um e uma invocação concluída. Também exige zero provider events e zero duplicidades.

Uma segunda chamada, e somente ela, com a mesma chave após sucesso deve retornar HTTP 409 `IDEMPOTENCY_REPLAY`. Em teste separado, uma falha sintética antes da conclusão retorna HTTP 500 e abandona a invocação incompleta; a mesma chave pode então ser adquirida e concluída. Esse retry não contorna idempotência: apenas invocações concluídas são replays definitivos.

## Segurança operacional

O relatório final é allowlisted e contém somente estados agregados. Ele não registra tokens, segredo interno, URL do banco, chave de idempotência, headers, UUIDs, payloads, fingerprints ou PII. O domínio sintético permitido é `example.invalid`. Falhas devem permanecer locais ao banco descartável; não enfraqueça triggers, histórico append-only ou regras produtivas para permitir limpeza.
