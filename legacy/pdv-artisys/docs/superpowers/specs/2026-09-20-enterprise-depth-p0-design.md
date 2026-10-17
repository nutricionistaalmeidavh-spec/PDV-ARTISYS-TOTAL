# Enterprise Depth P0 Design

## Contexto

O PDV ArtiSys já possui profundidade relevante em checkout, caixa, devoluções, auditoria, restaurante, impressão, backup e infraestrutura local-first. A auditoria comparando o produto com um PDV maduro e com um ERP enterprise mostrou, porém, que o núcleo ainda é superficial em cinco fluxos operacionais: custo histórico, compras/recebimento, estoque por local, transferências/reservas e pedidos/fulfillment.

O objetivo deste P0 é aprofundar esses fluxos sem reescrever o PDV nem criar um ERP paralelo. A implementação deve preservar vendas, restaurante, verticais, API LAN, dados existentes e compatibilidade das instalações atuais.

## Objetivo

Entregar uma camada de profundidade operacional que permita executar, rastrear e testar ponta a ponta:

- custo histórico correto por item vendido;
- estoque físico por local;
- estoque reservado e disponível;
- pedidos de compra e recebimentos parciais/totais;
- atualização de custo por recebimento;
- contas a pagar originadas de compras;
- transferências entre locais com estado em trânsito;
- orçamento e pedido de cliente;
- reserva, separação e fulfillment parcial/total;
- conversão do pedido em venda usando o núcleo existente;
- documentação e release gate coerentes com a versão 1.4.0.

## Princípios

1. **Evolução incremental compatível.** Não reescrever o SaleService nem o EventBus.
2. **Migrations não destrutivas.** Nenhum dado existente pode ser descartado.
3. **Uma única verdade para movimentação física.** O estoque físico continua sendo derivado de movimentos; compras, transferências e pedidos apenas orquestram esses movimentos.
4. **Snapshot para fatos históricos.** Custo de venda deve ser persistido no momento da conclusão e nunca recalculado a partir do cadastro atual.
5. **Idempotência.** Recebimentos, transferências, fulfillment e conversões devem resistir a retry sem duplicar efeitos.
6. **Auditoria.** Toda mutação relevante deve gerar audit log e, quando aplicável, evento durável.
7. **Backend → API → Client → UI → E2E.** Nenhuma capacidade é considerada suportada sem todas as superfícies exigidas pelo registry.
8. **Sem SaaS obrigatório.** Todo o P0 permanece local-first e compatível com LAN.

## Escopo 1 — Custo e margem históricos

Adicionar `cost_cents_snapshot` aos itens de venda, com metadata opcional de origem do custo.

### Regra

Ao concluir uma venda, para cada item físico/comercial que possua produto associado:

- capturar o custo corrente aplicável;
- persistir esse custo no item da venda;
- relatórios futuros devem usar o snapshot, nunca `products.cost_cents` para vendas novas.

Vendas anteriores à migration não devem inventar um custo histórico. O relatório pode cair para o custo atual apenas como estimativa e deve marcar essa origem como estimada quando exposto ao usuário ou aos consumidores de relatório.

Devoluções devem usar o mesmo snapshot do item original para recompor custo/margem.

## Escopo 2 — Estoque por local

Introduzir o conceito de local de estoque sem quebrar instalações existentes.

### Entidades

- `stock_locations`
- `inventory_location_balances`
- `terminal_stock_locations`

Cada instalação atual recebe idempotentemente um local padrão:

- id lógico estável: `MAIN`
- nome: `Estoque principal`
- ativo por padrão.

O saldo existente deve ser migrado para `MAIN`.

### Compatibilidade

A API e UI atuais que não informam local continuam funcionando e usam `MAIN`.

`inventory_balances` deve continuar sendo legível como visão agregada/compatível durante a transição. O novo código de domínio deve preferir `inventory_location_balances`.

### Semântica

Para cada produto e local:

- `physicalQuantity`: saldo físico;
- `reservedQuantity`: quantidade comprometida;
- `availableQuantity = physicalQuantity - reservedQuantity`.

Disponível nunca pode ficar negativo.

## Escopo 3 — Compras e recebimento

Criar domínio `procurement`.

### Entidades

- `purchase_orders`
- `purchase_order_items`
- `purchase_receipts`
- `purchase_receipt_items`

### Estados de pedido de compra

- `DRAFT`
- `ORDERED`
- `PARTIALLY_RECEIVED`
- `RECEIVED`
- `CANCELLED`

### Fluxo

1. Criar pedido para fornecedor existente.
2. Adicionar itens com quantidade e custo acordado.
3. Confirmar pedido.
4. Receber uma ou mais vezes.
5. Cada recebimento gera movimentos `purchase` no local informado.
6. O status do pedido é recalculado conforme quantidade recebida.
7. Receber acima do pedido deve falhar.
8. Recebimento repetido com a mesma chave idempotente não pode duplicar estoque nem financeiro.

### Custo

O custo corrente do produto passa a ser atualizado por custo médio móvel ponderado usando o saldo físico anterior e o custo do recebimento.

O custo histórico das vendas continua preservado por snapshot.

### Financeiro

Recebimento pode gerar uma conta a pagar vinculada ao pedido/recebimento. A implementação P0 não cria contabilidade de partidas dobradas; utiliza o `FinanceService` existente.

## Escopo 4 — Transferências e estoque em trânsito

Criar domínio `inventory-logistics`.

### Entidade

- `stock_transfers`
- `stock_transfer_items`

### Estados

- `DRAFT`
- `IN_TRANSIT`
- `RECEIVED`
- `CANCELLED`

### Regras

- origem e destino devem ser locais diferentes e ativos;
- despacho valida disponibilidade na origem;
- despacho reduz físico da origem e registra quantidade em trânsito no próprio transfer;
- recebimento aumenta físico no destino;
- cancelamento antes do despacho não altera estoque;
- cancelamento após despacho deve exigir fluxo explícito de retorno, não apagar o histórico;
- retry de despacho/recebimento deve ser idempotente.

## Escopo 5 — Reserva de estoque

### Entidade

- `inventory_reservations`

### Regras

Uma reserva pertence a:

- produto;
- local;
- quantidade;
- source type/id;
- status (`ACTIVE`, `RELEASED`, `CONSUMED`, `CANCELLED`).

Criar reserva valida `availableQuantity`.

Liberar ou cancelar devolve disponibilidade sem alterar o físico.

Consumir uma reserva ocorre junto do fulfillment/venda e não pode ser aplicado duas vezes.

O checkout normal passa a validar disponibilidade considerando reservas. Venda vinculada ao pedido que possui a reserva pode consumir a reserva correspondente em vez de ser bloqueada por ela.

## Escopo 6 — Orçamento, pedido e fulfillment

Criar domínio `orders`.

### Entidades

- `sales_orders`
- `sales_order_items`
- `sales_order_fulfillments`
- `sales_order_fulfillment_items`

### Estados

- `DRAFT`
- `QUOTED`
- `CONFIRMED`
- `PARTIALLY_FULFILLED`
- `FULFILLED`
- `CANCELLED`

### Tipo de atendimento

- `PICKUP`
- `DELIVERY`

### Fluxo

1. Criar orçamento/pedido para cliente.
2. Adicionar itens, quantidades e preço snapshot.
3. Confirmar pedido.
4. Criar reservas no local de origem.
5. Registrar fulfillment parcial ou total.
6. Converter fulfillment em venda pelo `SaleService` existente.
7. Pagamento continua usando as regras normais do PDV/caixa.
8. Cancelamento libera reservas ativas.

O P0 não cria outro checkout, outro estoque nem outro financeiro.

## API

Adicionar endpoints versionados sob `/api/v1`:

- `/stock-locations`
- `/inventory/availability`
- `/stock-reservations`
- `/stock-transfers`
- `/purchase-orders`
- `/purchase-receipts`
- `/sales-orders`
- `/sales-orders/:id/fulfillments`

Mutações administrativas/gerenciais exigem `admin` ou `manager`. Operações de fulfillment no balcão podem aceitar `cashier` apenas quando a regra do fluxo permitir e sempre devem manter auditoria.

## Client e UI

### Estoque

A tela de estoque passa a permitir seleção de local e exibe:

- físico;
- reservado;
- disponível;
- mínimo;
- situação.

### Compras

Nova área com:

- pedidos;
- recebimentos;
- fornecedor;
- itens;
- quantidades pedida/recebida/pendente;
- custo;
- status.

### Logística

Nova área com:

- locais;
- transferências;
- origem/destino;
- itens;
- em trânsito;
- recebimento.

### Pedidos

Nova área com:

- orçamento;
- pedido;
- cliente;
- retirada/entrega;
- data prevista;
- reserva;
- fulfillment;
- vínculo com venda.

A UI deve evitar duplicar telas de cadastro já existentes.

## Migração e compatibilidade

- executar migration idempotente;
- criar `MAIN` somente se ainda não existir;
- copiar saldos agregados existentes para o local `MAIN` uma única vez;
- manter rotas antigas compatíveis;
- manter consultas antigas de saldo funcionando durante o P0;
- não alterar IDs de produtos, vendas, clientes ou fornecedores;
- preservar vendas e movimentos históricos.

## Release e capacidade

Adicionar uma nova fase de release:

### Fase 9 — Profundidade operacional

Cobertura mínima:

- historical-cost-snapshot
- stock-locations
- stock-availability-reservations
- procurement-purchase-receiving
- moving-average-cost
- payable-from-purchase
- stock-transfer-in-transit
- quote-order-fulfillment
- order-to-sale-integration

O registry de capacidades deve declarar a nova superfície customer/admin e exigir Backend → API → Client → UI → E2E.

## Cenário E2E obrigatório

O release não passa sem uma jornada automatizada que:

1. cria fornecedor;
2. cria produto;
3. cria local secundário;
4. cria pedido de compra;
5. recebe parcialmente;
6. verifica estoque e conta a pagar;
7. recebe o restante;
8. transfere parte para outro local;
9. verifica `IN_TRANSIT`;
10. recebe transferência;
11. cria orçamento;
12. confirma pedido;
13. reserva estoque;
14. prova que venda concorrente não consome a quantidade reservada;
15. registra fulfillment;
16. gera/conclui venda usando o núcleo existente;
17. altera o custo corrente do produto;
18. consulta relatório da venda antiga;
19. confirma que margem/custo histórico permanecem baseados no snapshot.

## Versionamento e documentação

A versão alvo é `1.4.0`.

`docs:check` deve falhar quando a versão declarada em artefatos oficiais de release/documentação divergir de `package.json.version`.

Atualizar `release/limitations.json` para não descrever a 1.4.0 como 1.3.2 e para documentar explicitamente o que ainda permanece fora do produto.

## Fora do P0

Não implementar neste lote:

- partidas dobradas;
- plano de contas contábil enterprise;
- conciliação bancária;
- fiscal comercial completo;
- multiempresa;
- fidelidade/cashback;
- lote/validade/serial;
- RBAC enterprise por permissão/limite;
- failover/offline completo;
- omnichannel/e-commerce.

## Critérios de aceite

O P0 é aceito somente se:

1. migrations antigas e novas forem idempotentes;
2. dados existentes continuarem legíveis;
3. venda normal sem local explícito continuar funcionando em `MAIN`;
4. custo histórico de vendas novas permanecer imutável após alteração de custo do produto;
5. reservas impedirem oversell;
6. recebimento parcial não fechar pedido indevidamente;
7. recebimento duplicado não duplicar estoque/financeiro;
8. transferência representar corretamente o estado em trânsito;
9. pedido suportar fulfillment parcial e total;
10. pedido converter para venda sem duplicar regras de checkout;
11. capability registry permanecer em 100% das capacidades customer/admin suportadas;
12. testes unitários, integração, release gates e E2E passarem;
13. documentação/versionamento refletirem 1.4.0.
