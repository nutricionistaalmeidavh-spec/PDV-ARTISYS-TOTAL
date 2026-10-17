# Fontes de reuso do PDV ArtiSys

Este arquivo registra as origens e os critérios de adaptação dos módulos reaproveitados no novo PDV. O objetivo é reutilizar contratos e padrões maduros sem carregar decisões legadas incompatíveis com a arquitetura local/LAN atual.

## PDVNexus

Reutilizado/adaptado:
- regras puras de pagamento, estoque, inventário, caixa, autorização e cancelamento;
- testes de regressão das regras de PDV;
- uso de `node:sqlite`, servidor `node:http` e padrões de operação local;
- agregadores de dashboard/relatórios e exportação CSV;
- padrões de integração serial para balança e periféricos;
- impressão Electron e formatação de comprovante.

Não reutilizado literalmente:
- snapshot JSON como fonte primária;
- reset destrutivo do banco quando a versão muda;
- senhas em texto simples;
- baixa direta de estoque dentro da finalização da venda;
- CORS wildcard;
- acesso serial genérico exposto ao renderer.

## CLINICASMEDICAS

Reutilizado/adaptado:
- migrations versionadas e idempotentes;
- sanitização de auditoria e exclusão de segredos;
- desenho de EventBus/outbox persistente;
- armazenamento de credenciais com fronteira Electron/`safeStorage`.

## Mudanças obrigatórias no novo PDV

- dinheiro em centavos inteiros;
- SQLite acessado apenas pelo servidor autoritativo;
- outbox persistente + EventBus;
- efeitos idempotentes por `eventId + effectKey`;
- estoque e caixa por movimentos imutáveis;
- devolução como transação própria, sem reescrever venda original;
- impressão como fila persistente e efeito externo;
- credenciais protegidas fora do renderer e do banco operacional;
- API `/api/v1` em vez de sincronização por snapshot completo;
- UI substituível sem alterar domínio, persistência ou integrações.
