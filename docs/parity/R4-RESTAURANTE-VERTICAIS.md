# R4 — Restaurante, comandas, KDS e demais verticais

Data: 2026-10-18. Baseline desktop: `7efea9c61f75be1536a1e516e917218f2b8bf2bf`.

## Escopo canônico (13 capacidades)

| ID | Capacidade | Origem já existente | Evidência web adicional nesta entrega |
|---|---|---|---|
| cap-009 | Fichas técnicas/consumo de ingredientes | Domínio legado de receitas e estoque | Não implementado nesta entrega |
| cap-031 | Mesas, comandas, pedidos e transferência | Core `restaurant-service` + API de mesas | Transferência de mesa sem clonar comanda |
| cap-032 | Divisão de contas, taxa de serviço, transferência de itens | Core `restaurant-settlement-service` | Não implementado na API D1 nesta entrega |
| cap-033 | Checkout restaurante no caixa e estoque canônicos | Core `restaurant-settlement-service` | Pendente vínculo transacional web entre comanda e venda |
| cap-034 | KDS: estações, rotas de produto/impressora | Core `kitchen-service` | Rotas completas D1 pendentes |
| cap-035 | KDS compartilhado por canais | Core `kitchen-service` | Fluxo web atual tem ticket por pedido; estações pendentes |
| cap-036 | Pizzaria: tamanhos, sabores, bordas e preços | Core `pizzeria` e UI existente | Não implementado na API D1 nesta entrega |
| cap-037 | Delivery, retirada e balcão | Core `delivery`, UI existente | Cancelamento pré-produção na API D1 |
| cap-038 | Pedidos unificados, senhas e histórico legado | Core `food-order`, UI existente | Cancelamento idempotente; senhas/histórico D1 pendentes |
| cap-039 | Padaria e itens por peso | Core de pesagem e padaria | Paridade de balança física pendente |
| cap-041 | Onboarding por segmento/módulos | Registro de módulos e primeira entrada | Recomendações e gestão web D1 pendentes |
| cap-048 | Chamados de garçom e conta | Core `restaurant-service` | Chamados persistidos e transições autorizadas |
| cap-049 | Relatórios restaurante e CSV | Core `restaurant-reporting-service` | Resumo por filial e período e CSV operacional |

**Estado de paridade:** a existência de código ou teste de API não certifica capacidade integral. Não alterar os estados das 56 capacidades sem matriz completa e revisão independente. O termo *13* se refere às capacidades, não a treze setores do varejo.

## Contratos introduzidos nesta rodada

- `POST /api/v1/tenants/:tenant/restaurant/sessions/:session/transfer` — `{branchId,targetTableId}`; destino deve estar ativo e livre.
- `POST /api/v1/tenants/:tenant/restaurant/sessions/:session/requests` — `{branchId,type:'WAITER'|'BILL',note?}`.
- `GET /api/v1/tenants/:tenant/restaurant/requests?branchId=:branch`.
- `PATCH /api/v1/tenants/:tenant/restaurant/requests/:id` — `{branchId,status:'ACKNOWLEDGED'|'CLOSED'}`.
- `POST /api/v1/tenants/:tenant/restaurant/orders/:id/cancel` — apenas antes de iniciar a produção.
- `GET /api/v1/tenants/:tenant/restaurant/reports/summary?branchId=:branch&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- `GET /api/v1/tenants/:tenant/restaurant/reports/csv?branchId=:branch&from=YYYY-MM-DD&to=YYYY-MM-DD`.

Escritas usam `X-Mutation-ID` obrigatório, com escopo por estabelecimento. Os relatórios consideram datas **UTC** inclusivas e no máximo 366 dias, 3.000 pedidos. `orderedCents` exclui cancelados; **não corresponde a faturamento/recebimento**; vendas, caixa e estoque pertencem ao checkout único.

## Persistência e acesso

Migração incremental `0021_r4_restaurant_operations.sql` adiciona apenas chamados. Mesas/comandas e pedidos reutilizam tabelas existentes. A API usa `restaurant.service.manage`, `restaurant.orders.transfer`, `reports.view` e `restaurant.access`; o tenant é resolvido pela sessão, nunca pelo corpo da requisição. SQLite self-hosted é o padrão gratuito; D1 é opcional, não dependência.

## Critérios pendentes para R4 integral

1. Fazer a jornada UI/PWA ↔ API de restaurante sem endpoints locais de desktop exclusivos.
2. Associar cobrança, divisão de conta e taxa de serviço a uma única venda concluída, com idempotência e conciliação estoque/caixa/financeiro.
3. Igualar mesa, operação de garçom, KDS por estação, roteamento por produto e impressão à baseline desktop, incluindo dispositivos autorizados e recuperação após falhas.
4. Portar as políticas de pizza, delivery/retirada/senha, histórico, padaria/balança, ficha técnica e onboarding de módulos sem duplicação da autoridade de vendas.
5. Provar acessos de todos os perfis, isolamento multiempresa, concorrência, falhas e dispositivo físico quando aplicável; executar testes navegadores PC/tablet/celular e homologação independente.

**Não rotular R4 como integral** antes de concluir estes critérios e atualizar evidências canônicas com a execução da CI no SHA exato.
