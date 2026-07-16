# Threat model operacional

## Ativos e atores

Ativos: PII de leads/contatos, opt-outs, evidência agregada, credenciais de banco, leases, idempotência e decisão de não envio. Atores: operador autorizado, serviço API, worker, PostgreSQL, Overpass e agente externo não autenticado quando um modo público é ativado.

## Fronteiras, entradas e saídas

Fronteiras: cliente→API, API/worker→PostgreSQL, worker→Overpass, CLI/CI→artefatos e proxy→endpoints internos. Entradas externas: JSON/query da API e resposta Overpass. Entradas controladas pelo operador: ambiente, CLI, restore e deploy. Saídas permitidas no shadow: respostas de negócio necessárias e evidência agregada; envio, provider, webhook e rede externa de campanha são proibidos.

## Ameaças e controles

| Ameaça | Controle | Critério de bloqueio do piloto |
|---|---|---|
| envio acidental / bypass shadow | guard obrigatório antes de claim, default true, adapter somente simulado | qualquer claim/adapter/confirm/retry com guard ativo |
| vazamento de PII/log sensível | projeções e serializers allowlisted; canaries | PII, payload, mensagem, token, SQL ou stack em log/erro/relatório/snapshot |
| bypass de opt-out/bloqueio | opt-out imutável, flags monotônicas, rechecagem transacional | qualquer lead bloqueado/opt-out elegível ou confirmado |
| duplicidade/replay | idempotency key, fingerprint, token/generation fencing | contagem ou decisão muda em replay idêntico |
| endpoint interno exposto | bind/perímetro privado e resposta agregada | publicação sem autenticação/autorização de perímetro |
| abuso de CLI/configuração | schemas estritos, IDs seguros, defaults fail-closed | path arbitrário, valor inválido aceito ou shadow false |
| restore reintroduz dado bloqueado | runbook de reconciliação e validação pós-restore | ausência de delta de exclusão/opt-out aplicado |
| lead incorreto / operador excede limite | limites, amostra humana, NO_GO | limite, precisão ou incidente fora do critério |
| futura separação de clientes | fora desta PR | qualquer segundo cliente antes de isolamento testado |

Riscos residuais: autenticação pública, multi-tenant, anonimização histórica e reconciliação automatizada de restore exigem projetos próprios.

