# P1 — Endereçamento de estoque por filial

## Funcionalidade entregue

A tela **Estoque → Endereços de armazenagem** cadastra locais físicos (código e descrição) exclusivamente dentro da filial corrente, exibe a lista de endereços e permite vincular ou desvincular o endereço padrão de produtos ativos que controlam estoque. O endereço tem identidade estável; vínculos cruzando empresa/filial são bloqueados por chaves estrangeiras compostas e pela API. O gerenciamento exige `inventory.adjust`; consultas exigem `inventory.view`.

A API usa as rotas canônicas `GET/POST /api/v1/inventory/locations` e `GET/POST /api/v1/inventory/locations/assign`. Mutação exige chave idempotente; operações válidas são auditadas em `commerce_mutations`. Dados persistem nas tabelas aditivas `inventory_storage_locations` e `inventory_product_location_assignments` (migração 0019), sem catálogo duplicado.

## Limite importante

**Endereçamento não é estoque por endereço.** O único saldo quantitativo continua em `inventory_movements` e `stock_positions`, por filial e produto. O endereço é orientação de armazenagem principal, não quantidade distribuída em múltiplas prateleiras. Movimentações entre endereços com quantidade, reservas por local e inventário contado por endereço exigem extensão transacional de ledger, com posterior confrontação desktop/web e QA em local físico; não estão certificados aqui.

## Evidências

- `apps/api/test/p1-stock-locations.test.mjs`: localização por empresa/filial, idempotência, código único, limpeza de vínculo e verificação de que o saldo não mudou.
- `apps/api/test/commerce.test.mjs`: rotas HTTP, autorização, isolamento e ausência de alteração de inventário.
- `scripts/web-browser-e2e.mjs`: cadastro de endereço e vínculo na tela canônica em Chromium.
- Workflow: migração 0019 testada no D1 local, enquanto local SQLite aplica migrações canônicas uma única vez.

Módulo segue `partial` até atender a movimentações quantitativas por endereço e certificação independente. Nenhum serviço pago foi adicionado; desktop original permanece apenas para comparação.
