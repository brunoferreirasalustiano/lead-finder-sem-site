# Retenção e exclusão de dados

O manifesto de supressão pós-restore é sensível, mínimo e temporário: permissão restrita, armazenamento fora do Git, digest validado antes de escrita e descarte seguro após retenção aprovada. Alvo não resolvido bloqueia retomada e não autoriza recriação de PII ou exclusão de histórico.

Princípios: minimizar, limitar acesso, registrar somente agregados e não executar exclusão destrutiva automática sem teste PostgreSQL e backup verificável.

| Classe | Política operacional |
|---|---|
| fixtures e dados de teste | descartar ao fim do job; nunca misturar com produção |
| payload bruto e mensagens | não exportar/logar; reter apenas pelo menor período necessário a replay/incidente |
| evidência agregada shadow | 30 dias por padrão, revisão e descarte documentado |
| logs sanitizados | conforme rotação do ambiente, sem PII ou segredo |
| opt-out | permanente e imutável; exclusão de PII não remove a supressão necessária |
| exclusão temporária | seis meses contados por decisão persistida; reentrada exige nova qualificação e nunca remove bloqueio/opt-out |
| solicitação de exclusão | identificar tabelas e snapshots, executar procedimento aprovado, validar ausência e preservar supressão mínima |

Backups devem ser criptografados e ter acesso mínimo. Antes de restore, capture o delta de exclusões, opt-outs e bloqueios posterior ao backup; após restore, reaplique o delta antes de subir API/worker e valide que nenhum contato foi reabilitado. Sem essa reconciliação, o restore é `NO_GO`. A automação destrutiva e a anonimização retroativa de snapshots ficam fora desta PR até existirem testes de upgrade, rollback e restauração.

