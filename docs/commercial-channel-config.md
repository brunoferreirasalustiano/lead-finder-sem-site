# Canal comercial oficial — Lead Finder Brasil

## Identificação

- Marca: `Lead Finder Brasil`
- Responsável operacional: configurado fora do repositório
- E-mail operacional: configurado fora do repositório
- WhatsApp Business: configurado fora do repositório
- Formato de telefone esperado: E.164, somente dígitos no runtime

## Fonte de configuração

Os valores completos dos canais operacionais não devem ser versionados. A aplicação deve recebê-los por configuração de ambiente ou gerenciador de segredos, usando nomes explícitos e sem valores reais nos arquivos `.env.example`.

Referências previstas:

- `COMMERCIAL_EMAIL`
- `COMMERCIAL_WHATSAPP_E164`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`

## Uso autorizado

O canal externo aprovado é destinado a contatos manuais, individuais e revisados durante o piloto controlado e aos botões públicos do catálogo de demonstrações.

Regras obrigatórias:

- contato somente após revisão humana individual;
- nenhuma automação por WhatsApp Web;
- nenhum disparo em massa;
- nenhuma integração de provider, webhook, SDK ou n8n habilitada sem gate próprio;
- opt-out imediato e permanente;
- qualquer pedido de interrupção deve registrar `NAO_CONTATAR`;
- nenhum segundo contato após opt-out;
- mensagens e evidências técnicas não devem expor contatos completos, tokens, payloads ou conteúdo integral de conversas.

## Estado técnico

Este documento registra somente que existe um canal comercial aprovado e externo ao Git. Ele não configura envio pela API, worker, banco de dados ou infraestrutura e não altera os flags de egress/shadow mode.
