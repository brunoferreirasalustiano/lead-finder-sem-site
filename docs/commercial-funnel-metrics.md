# Métricas do funil comercial

Registro humano/auditável em UTC; uma etapa por lead/coorte. Analisar por segmento, cidade/região, faixa de score, origem, coorte temporal, oferta, campanha e `cliente_futuro` (somente dimensão, sem multi-tenancy).

| Métrica | Fórmula/definição |
|---|---|
| Captados / qualificados / aprovados | únicos criados; atendem regra; aprovados/revisados |
| Contatáveis / abordados | aprovados com contato válido e sem bloqueio/opt-out; contato manual registrado |
| Respostas / positivas / reuniões / propostas / vendas | eventos CRM registrados, positivos segundo critério da oferta |
| Receita atribuída | soma de receita atribuída a vendas da coorte |
| Custo por lead útil/reunião/venda | custo elegível dividido por contatáveis/reuniões/vendas |
| Tempo até resposta/conversão | média `resposta-abordagem` / `ganho-captação` |

Denominador zero é `NOT RUN`, nunca conversão 0%.
