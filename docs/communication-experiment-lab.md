# Laboratório sintético de comunicação

## Objetivo

Comparar hipóteses de primeiro contato e aquisição de opt-in sem enviar mensagens, habilitar providers ou utilizar dados pessoais reais.

O laboratório não mede conversão real. Ele verifica consistência, segurança, clareza estrutural, adequação do canal e diferenças heurísticas entre variantes antes de um experimento humano mínimo.

## Soluções avaliadas

1. e-mail `permission-first`;
2. e-mail `diagnosis-first`;
3. e-mail `benefit-first`;
4. e-mail de credibilidade com um link institucional próprio;
5. formulário empresarial curto;
6. DM em perfil empresarial perguntando o melhor canal;
7. landing page ou QR Code para opt-in inbound;
8. indicação ou parceria;
9. anúncio click-to-WhatsApp iniciado pelo negócio;
10. WhatsApp depois de `DIRECT_OPT_IN`, `FORM_OPT_IN` ou `SIGNED_RECORD`.

## Matriz

### Casos centrais

A suíte cria exatamente **1.080 testes Vitest nomeados** combinando:

- nove grupos de nichos;
- cinco estados de oportunidade digital;
- quatro estilos de abertura;
- três tons;
- dois CTAs centrais;
- quatro canais distribuídos deterministicamente.

Todos os casos centrais possuem:

- opt-out explícito;
- placeholders, sem PII real;
- fonte coerente com o canal;
- autorização válida quando o canal é WhatsApp;
- limite de tamanho por canal;
- ausência de alegações garantidas ou afirmação de entrega.

### Matriz ampliada

O relatório agrega **14.580 cenários** com variação adicional de:

- três CTAs;
- três níveis de personalização;
- três estilos de opt-out;
- três políticas de link;
- distribuição entre e-mail, formulário, DM e WhatsApp pós-opt-in.

A matriz ampliada inclui casos intencionalmente inválidos para comprovar bloqueios.

## Bloqueios testados

- WhatsApp sem opt-in atual;
- número público tratado como autorização;
- lista comprada ou dado vazado;
- ausência de opt-out;
- link de terceiro no primeiro contato;
- mensagem acima do limite do canal;
- PII real no template;
- alegações enganosas;
- afirmação de envio, entrega ou disparo automático.

## Pontuação heurística

A pontuação varia de 0 a 100 e serve somente para ordenação de hipóteses.

Ela considera:

- oportunidade digital observada;
- canal;
- estilo de abertura;
- tom;
- CTA;
- personalização;
- opt-out;
- política de link;
- coerência da fonte;
- autorização de WhatsApp.

Um caso bloqueado recebe score zero, independentemente da qualidade textual.

## Leitura dos resultados

Resultados sintéticos podem indicar quais hipóteses merecem um teste real pequeno, mas não demonstram:

- taxa de abertura;
- taxa de resposta;
- conversão;
- receita;
- preferência de um nicho;
- reputação de canal;
- percepção humana da marca.

Essas métricas exigem contato real autorizado, amostra controlada e registro operacional.

## Resultado provisório esperado

A calibração inicial tende a favorecer:

- abertura `DIAGNOSIS_FIRST` quando existe problema verificável;
- tom `CONSULTATIVE`;
- CTA `ASK_PERMISSION`;
- personalização `DIAGNOSIS`;
- opt-out explícito;
- ausência de link ou, quando necessário, um único link institucional próprio;
- WhatsApp como canal forte somente após opt-in.

O workflow é a autoridade para os valores efetivos do head testado.

## Execução

```bash
npx vitest run packages/messaging/src/communication-lab.test.ts --reporter=dot
npx tsx scripts/communication-experiment-report.ts
```

Os artefatos ficam em:

```text
artifacts/communication-lab/communication-experiment-report.json
artifacts/communication-lab/communication-experiment-report.md
```

## Critério para promover uma variante

Uma variante pode ir para experimento real somente quando:

1. não estiver bloqueada;
2. estiver entre as melhores hipóteses do canal apropriado;
3. tiver mensagem revisada por humano;
4. estiver associada a um diagnóstico verdadeiro;
5. possuir canal elegível e supressões limpas;
6. tiver aprovação individual de Bruno;
7. fizer parte de uma onda manual de no máximo cinco contatos.

## Experimento humano mínimo recomendado

- um nicho;
- uma região;
- duas variantes no máximo;
- até cinco contatos manuais por onda;
- sem follow-up automático;
- medir resposta, autorização para demonstração, opt-out e qualidade da conversa;
- não alterar política com base em um único contato.

## Segurança

O laboratório é puro e determinístico:

- nenhuma rede;
- nenhum provider;
- nenhuma escrita externa;
- nenhum webhook;
- nenhuma mensagem;
- nenhum dado pessoal real;
- nenhum claim de conversão real.

Tracker: issue #103.
