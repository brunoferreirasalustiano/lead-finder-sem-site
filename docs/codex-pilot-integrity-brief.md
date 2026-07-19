# Brief técnico — integridade referencial do piloto

Base inicial esperada: `main` após `87c0836f3161ea3af546cf834c5e38ddc7a9349f`.

## Problema

A migration `0011_internal_pilot.sql` protege algumas relações compostas, mas o PostgreSQL ainda aceita estados cruzados que o serviço tenta impedir:

1. `pilot_manual_contacts.contact_id` pode apontar para um contato pertencente a outro `lead_id`.
2. `pilot_timeline_events.lead_id` pode apontar para um lead que não pertence ao `pilot_run_id` do evento.
3. Escritas SQL diretas, imports defeituosos ou futuras rotas podem contornar as verificações da aplicação.

## Objetivo

Criar uma migration incremental que torne o PostgreSQL a autoridade dessas relações, preserve compatibilidade com instalações existentes e falhe de forma explícita diante de registros inconsistentes.

## Requisitos mínimos

- não editar a migration `0011` já publicada;
- criar migration incremental seguinte;
- auditar registros preexistentes antes de adicionar constraints;
- não apagar, corrigir silenciosamente ou reassociar dados inconsistentes;
- garantir que contato manual pertença ao mesmo lead e piloto;
- garantir que timeline com `lead_id` pertença ao mesmo piloto;
- avaliar se `pilot_results` necessita reforço adicional além da FK composta existente;
- manter tabelas históricas append-only;
- preservar idempotência de aplicação das migrations;
- definir nomes estáveis para constraints e índices;
- atualizar o schema TypeScript quando necessário;
- manter o serviço com validações defensivas, sem confiar somente nelas.

## Testes PostgreSQL obrigatórios

- migration aplicada duas vezes;
- banco vazio;
- banco com dados válidos preexistentes;
- banco com contato cruzado preexistente deve abortar de forma segura e identificável;
- banco com timeline cruzada preexistente deve abortar de forma segura e identificável;
- insert válido de contato manual;
- rejeição de contato pertencente a outro lead;
- insert válido de timeline sem lead;
- insert válido de timeline com lead do piloto;
- rejeição de timeline com lead de outro piloto;
- rollback transacional sem constraint parcial;
- integração completa executada duas vezes;
- restart lógico e regressão do piloto.

## Limites

Não habilitar provider, webhook, SDK, coleta externa, scraping, envio, WhatsApp Web, n8n, credencial real, dado pessoal real ou deploy produtivo.

Não fazer merge automático. Abrir PR Ready for Review e apresentar evidências completas.