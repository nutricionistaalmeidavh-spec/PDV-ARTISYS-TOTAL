# Enterprise Depth P0 Implementation Plan

> **Atualização de licenciamento (2026-10-04):** a restrição histórica “sem assinatura obrigatória” não se aplica mais à distribuição comercial. O executável oficial exige ativação inicial; o core permanece local/self-hosted após a liberação.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a Fase 9 de profundidade operacional do ArtiSys PDV 1.4.0: custo histórico correto, estoque por local/reservas, compras/recebimentos, transferências e orçamento/pedido/fulfillment integrados ao núcleo atual.

**Architecture:** Evolução incremental e não destrutiva sobre o runtime atual. O ledger físico existente continua sendo a verdade de estoque; novas camadas (`inventory-logistics`, `procurement`, `orders`) orquestram o ledger, financeiro e vendas existentes. Instalações antigas migram para o local `MAIN`, rotas antigas continuam válidas e toda nova capacidade customer/admin só entra no release quando tiver Backend → API → Client → UI → E2E.

**Tech Stack:** Node.js >=22, `node:sqlite`/`DatabaseSync`, Electron, HTTP local `/api/v1`, EventBus/outbox existente, Node test runner, ArtiSys QA/Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-enterprise-depth-p0-design.md`

## Global Constraints

- Versão alvo: `1.4.0`.
- Sem SaaS, nuvem ou assinatura obrigatória; todo o P0 permanece local-first/LAN.
- Migrations devem ser idempotentes e não destrutivas.
- `MAIN` é o local padrão de compatibilidade para instalações/rotas antigas.
- Não duplicar checkout, financeiro ou ledger de estoque.
- Recebimentos, transferências, reservas e fulfillment devem ser idempotentes.
- Custo histórico de venda nova é snapshot imutável; vendas antigas podem usar fallback estimado, explicitamente marcado.
- O release só passa com capability coverage de 100% das capacidades customer/admin registradas.
- Woodpecker permanece manual-only; GitHub Actions continua sendo o CI automático autoritativo.

## Review Focus

1. **Migração de banco já populado:** saldo agregado existente deve aparecer integralmente em `MAIN`, sem duplicação após segunda execução da migration.
2. **Retry/idempotência:** repetir o mesmo recebimento, despacho, recebimento de transferência ou fulfillment com a mesma chave não pode duplicar estoque, financeiro ou venda.
3. **Concorrência lógica de reservas:** estoque reservado por um pedido deve bloquear venda concorrente, mas o próprio pedido deve conseguir consumir sua reserva.
4. **Custo histórico:** alterar `products.cost_cents` depois de uma venda não pode alterar custo/margem daquela venda; devolução deve usar o snapshot do item original.
5. **Compatibilidade:** checkout, restaurante, verticais e consultas antigas sem `locationId` devem continuar usando `MAIN` e passar nos testes existentes.

---

### Task 1: Schema P0, migration idempotente e local `MAIN`

**Files:**
- Create: `js/core/database/enterprise-depth-migrations.js`
- Create: `test/enterprise-depth-migrations.test.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `runEnterpriseDepthMigrations(db, now) -> number`
- Produces schema: `stock_locations`, `inventory_location_balances`, `terminal_stock_locations`, `inventory_reservations`, `purchase_orders`, `purchase_order_items`, `purchase_receipts`, `purchase_receipt_items`, `stock_transfers`, `stock_transfer_items`, `sales_orders`, `sales_order_items`, `sales_order_fulfillments`, `sales_order_fulfillment_items`.
- Adds columns: `inventory_movements.location_id`, `sales.stock_location_id`, `sale_items.cost_cents_snapshot`, `sale_items.cost_snapshot_source`.

- [ ] **Step 1: Write failing migration tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runEnterpriseDepthMigrations } = require('../js/core/database/enterprise-depth-migrations');

test('P0 migration creates MAIN and migrates legacy stock exactly once', () => {
  const db = openDatabase(':memory:');
  runMigrations(db, () => '2026-09-20T00:00:00.000Z');
  db.prepare("INSERT INTO categories(id,name,created_at,updated_at) VALUES('c','Geral','x','x')").run();
  db.prepare("INSERT INTO products(id,name,category_id,unit,sale_price_cents,cost_cents,created_at,updated_at) VALUES('p','Produto','c','UN',1000,600,'x','x')").run();
  db.prepare("INSERT INTO inventory_balances(product_id,quantity,updated_at) VALUES('p',7,'x')").run();

  runEnterpriseDepthMigrations(db, () => '2026-09-20T01:00:00.000Z');
  runEnterpriseDepthMigrations(db, () => '2026-09-20T02:00:00.000Z');

  assert.equal(db.prepare("SELECT COUNT(*) n FROM stock_locations WHERE id='MAIN'").get().n, 1);
  assert.equal(db.prepare("SELECT quantity FROM inventory_location_balances WHERE product_id='p' AND location_id='MAIN'").get().quantity, 7);
});
```

Also assert every new table exists and old sale/product IDs remain unchanged.

- [ ] **Step 2: Run the migration test and confirm RED**

Run: `node --test test/enterprise-depth-migrations.test.js`

Expected: FAIL because `enterprise-depth-migrations.js` does not exist.

- [ ] **Step 3: Implement the migration module**

Use a dedicated migration table to avoid collision with the existing shared `schema_migrations` versions:

```js
const { withTransaction } = require('./sqlite-database');
const ENTERPRISE_DEPTH_SCHEMA_VERSION = 1;

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function runEnterpriseDepthMigrations(db, now = () => new Date().toISOString()) {
  db.exec(`CREATE TABLE IF NOT EXISTS enterprise_depth_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  if (db.prepare('SELECT 1 FROM enterprise_depth_schema_migrations WHERE version=1').get()) return ENTERPRISE_DEPTH_SCHEMA_VERSION;

  withTransaction(db, () => {
    if (!hasColumn(db,'inventory_movements','location_id')) db.exec("ALTER TABLE inventory_movements ADD COLUMN location_id TEXT");
    if (!hasColumn(db,'sales','stock_location_id')) db.exec("ALTER TABLE sales ADD COLUMN stock_location_id TEXT");
    if (!hasColumn(db,'sale_items','cost_cents_snapshot')) db.exec("ALTER TABLE sale_items ADD COLUMN cost_cents_snapshot INTEGER");
    if (!hasColumn(db,'sale_items','cost_snapshot_source')) db.exec("ALTER TABLE sale_items ADD COLUMN cost_snapshot_source TEXT");
    // CREATE TABLE statements from the approved spec.
    db.prepare(`INSERT OR IGNORE INTO stock_locations(id,name,type,active,created_at,updated_at)
      VALUES('MAIN','Estoque principal','STORE',1,?,?)`).run(now(),now());
    db.exec(`INSERT OR IGNORE INTO inventory_location_balances(product_id,location_id,quantity,updated_at)
      SELECT product_id,'MAIN',quantity,updated_at FROM inventory_balances`);
    db.exec("UPDATE inventory_movements SET location_id='MAIN' WHERE location_id IS NULL OR location_id=''");
    db.exec("UPDATE sales SET stock_location_id='MAIN' WHERE stock_location_id IS NULL OR stock_location_id=''");
    db.prepare("INSERT INTO enterprise_depth_schema_migrations(version,name,applied_at) VALUES(1,'enterprise_depth_p0',?)").run(now());
  });
  return ENTERPRISE_DEPTH_SCHEMA_VERSION;
}
```

Schema rules must include foreign keys, state CHECKs, unique idempotency keys on receipt/transfer/fulfillment mutations, and indexes for `(product_id, location_id)` and operational status/date filters.

- [ ] **Step 4: Wire migration into runtime and lint**

In `createPdvRuntime`, call `runEnterpriseDepthMigrations(db,now)` after existing structural migrations and before constructing services. Add the migration module to `lint:core`.

- [ ] **Step 5: Run migration + existing database tests**

Run: `node --test test/enterprise-depth-migrations.test.js test/database.test.js test/e13-e14-operations.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/core/database/enterprise-depth-migrations.js js/core/pdv-runtime.js test/enterprise-depth-migrations.test.js package.json
git commit -m "feat: add enterprise depth P0 schema"
```

---

### Task 2: Snapshot histórico de custo e relatório imutável

**Files:**
- Modify: `js/domains/sales/sale-service.js`
- Modify: `js/domains/returns/return-service.js`
- Modify: `js/domains/reports/reporting-service.js`
- Create: `test/historical-cost-snapshot.test.js`

**Interfaces:**
- Produces on sale item: `costCentsSnapshot`, `costSnapshotSource`.
- `costSnapshotSource` values: `PRODUCT`, `VARIANT`, `ESTIMATED_CURRENT`.
- `buildSalesSummary()` must calculate realized cost from snapshot when present.

- [ ] **Step 1: Write RED tests for sale and return cost history**

```js
test('completed sale keeps original cost after product cost changes', () => {
  const sale = completeSaleAtCost(600);
  db.prepare('UPDATE products SET cost_cents=850 WHERE id=?').run('p1');
  const report = reports.buildSalesSummary({from:'2026-09-01',to:'2026-09-30'});
  assert.equal(report.productSales[0].estimatedCostCents, 600);
  assert.equal(db.prepare('SELECT cost_cents_snapshot FROM sale_items WHERE sale_id=?').get(sale.id).cost_cents_snapshot, 600);
});

test('return uses original sale item cost snapshot', () => {
  // sell at cost 600, change product to 850, return one unit
  assert.equal(report.productSales[0].estimatedCostCents, 0);
});
```

Also test a legacy sale with null snapshot returns `ESTIMATED_CURRENT` rather than pretending historical certainty.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/historical-cost-snapshot.test.js`

- [ ] **Step 3: Snapshot cost during `completeSale`**

Add a synchronous helper before sale status changes:

```js
function snapshotItemCosts(saleId) {
  const rows = db.prepare('SELECT id,product_id,configuration_json FROM sale_items WHERE sale_id=?').all(saleId);
  for (const item of rows) {
    const configuration = item.configuration_json ? JSON.parse(item.configuration_json) : null;
    const variant = configuration?.variantId
      ? db.prepare('SELECT cost_cents FROM product_variants WHERE id=?').get(String(configuration.variantId))
      : null;
    const product = db.prepare('SELECT cost_cents FROM products WHERE id=?').get(item.product_id);
    const cost = variant?.cost_cents ?? product?.cost_cents ?? 0;
    const source = variant?.cost_cents != null ? 'VARIANT' : 'PRODUCT';
    db.prepare('UPDATE sale_items SET cost_cents_snapshot=?,cost_snapshot_source=? WHERE id=? AND cost_cents_snapshot IS NULL')
      .run(cost,source,item.id);
  }
}
```

Call this inside the existing sale completion transaction before emitting `sale.completed`.

- [ ] **Step 4: Make reports and returns use original sale item cost**

In `reporting-service.js`, select `si.cost_cents_snapshot` and calculate cost with:

```js
const unitCost = item.costCentsSnapshot == null ? Number(item.currentCostCents || 0) : Number(item.costCentsSnapshot);
const source = item.costCentsSnapshot == null ? 'ESTIMATED_CURRENT' : item.costSnapshotSource;
```

For returns, join `return_items.sale_item_id` back to `sale_items.id` and subtract `sale_items.cost_cents_snapshot` (fallback current only for legacy rows).

- [ ] **Step 5: Run focused and report regression tests**

Run: `node --test test/historical-cost-snapshot.test.js test/e17-reporting.test.js test/return-service.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/domains/sales/sale-service.js js/domains/returns/return-service.js js/domains/reports/reporting-service.js test/historical-cost-snapshot.test.js
git commit -m "fix: preserve historical sale cost and margin"
```

---

### Task 3: Estoque por local, disponibilidade e reservas

**Files:**
- Modify: `js/domains/inventory/inventory-service.js`
- Create: `js/domains/inventory-logistics/inventory-logistics-service.js`
- Modify: `js/domains/sales/sale-service.js`
- Modify: `js/domains/inventory/inventory-effects.js`
- Modify: `js/domains/returns/return-effects.js`
- Modify: `js/core/pdv-runtime.js`
- Create: `test/inventory-logistics.test.js`

**Interfaces:**
- `inventory.move({...input, locationId='MAIN'}, actor)`
- `inventory.getBalance(productId, {locationId='MAIN'}={})`
- `inventory.listBalances({locationId='MAIN', aggregate=false, query='', lowStock=false}={})`
- `createInventoryLogisticsService({db,inventory,now,idFactory})`
- `logistics.getAvailability(productId, locationId='MAIN', {excludeSourceType=null,excludeSourceId=null}={}) -> {physicalQuantity,reservedQuantity,availableQuantity}`
- `logistics.createReservation({productId,locationId,quantity,sourceType,sourceId},actor)`
- `logistics.releaseSourceReservations(sourceType,sourceId,actor)`
- `logistics.bindSourceReservationsToSale(sourceType,sourceId,saleId)`
- `logistics.consumeSaleReservations(saleId)`

- [ ] **Step 1: Write RED tests for locations and reservation competition**

```js
test('reservation reduces available stock but not physical stock', () => {
  inventory.move({productId:'p',locationId:'MAIN',type:'purchase',quantityDelta:10});
  logistics.createReservation({productId:'p',locationId:'MAIN',quantity:4,sourceType:'sales-order',sourceId:'o1'}, manager);
  assert.deepEqual(logistics.getAvailability('p','MAIN'), {
    physicalQuantity:10,
    reservedQuantity:4,
    availableQuantity:6
  });
});

test('sale cannot consume another order reservation', () => {
  assert.throws(() => completeNormalSaleOf(7), /Estoque disponivel insuficiente/);
});
```

Also test old `inventory.getBalance('p')` and old movement without `locationId` still use `MAIN`.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/inventory-logistics.test.js`

- [ ] **Step 3: Make physical ledger location-aware without breaking aggregate balance**

Inside `performMove`, normalize `locationId` to `MAIN`, update `inventory_location_balances`, write `inventory_movements.location_id`, then update legacy `inventory_balances` to the sum across locations. This preserves current readers while new code gets location precision.

- [ ] **Step 4: Implement reservation service**

Reservations remain `ACTIVE` while bound to a sale so competing sales continue to see them as unavailable. `bindSourceReservationsToSale()` sets `bound_sale_id`; the sale's availability resolver excludes only reservations whose `source_type/source_id` it owns. Inventory sale effect calls `consumeSaleReservations(saleId)` only after physical stock movement succeeds.

- [ ] **Step 5: Integrate availability into sale completion**

Extend `createSaleService` dependencies:

```js
createSaleService({
  db, outbox, now, idFactory,
  stockRequirementsResolver,
  commissionService,
  availabilityResolver = null
})
```

Persist `sales.stock_location_id`, default `MAIN`, and replace direct aggregate stock validation with `availabilityResolver` when supplied.

- [ ] **Step 6: Keep returns location-aware**

Sale completion/cancellation/return events must include `stockLocationId`; inventory effects apply movements to that location. Legacy events without it default to `MAIN`.

- [ ] **Step 7: Run focused + core sale/stock regression tests**

Run: `node --test test/inventory-logistics.test.js test/inventory-service.test.js test/sale-service.test.js test/return-service.test.js test/e13-e14-operations.test.js`

- [ ] **Step 8: Commit**

```bash
git add js/domains/inventory js/domains/inventory-logistics js/domains/sales/sale-service.js js/domains/returns/return-effects.js js/core/pdv-runtime.js test/inventory-logistics.test.js
git commit -m "feat: add location-aware inventory and reservations"
```

---

### Task 4: Compras, recebimento parcial, custo médio e contas a pagar

**Files:**
- Create: `js/domains/procurement/procurement-service.js`
- Modify: `js/core/pdv-runtime.js`
- Create: `test/procurement-service.test.js`

**Interfaces:**
- `createProcurementService({db,inventory,finance,now,idFactory})`
- `createOrder({supplierId,locationId='MAIN',expectedAt=null,notes=null}, actor)`
- `addItem(orderId,{productId,quantity,unitCostCents},actor)`
- `confirmOrder(orderId,actor)`
- `receive(orderId,{idempotencyKey,items,receivedAt,createPayable=true,dueAt},actor)`
- `getOrder(id)` / `listOrders(filters)` / `listReceipts(filters)`

- [ ] **Step 1: Write RED tests for partial receive, over-receive, retry and moving average**

```js
test('partial receipt updates stock, moving average and payable once', () => {
  seedStock('p', 10, 600);
  const po = procurement.createOrder({supplierId:'s',locationId:'MAIN'}, manager);
  procurement.addItem(po.id,{productId:'p',quantity:10,unitCostCents:1000},manager);
  procurement.confirmOrder(po.id,manager);

  const first = procurement.receive(po.id,{idempotencyKey:'r1',items:[{productId:'p',quantity:5}],dueAt:'2026-10-10'},manager);
  const retry = procurement.receive(po.id,{idempotencyKey:'r1',items:[{productId:'p',quantity:5}],dueAt:'2026-10-10'},manager);

  assert.equal(first.id,retry.id);
  assert.equal(procurement.getOrder(po.id).status,'PARTIALLY_RECEIVED');
  assert.equal(inventory.getBalance('p',{locationId:'MAIN'}),15);
  assert.equal(db.prepare("SELECT cost_cents FROM products WHERE id='p'").get().cost_cents,733);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM financial_entries WHERE source_type='PURCHASE_RECEIPT'").get().n,1);
});
```

Also assert receipt > pending quantity throws and does not alter stock/finance.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/procurement-service.test.js`

- [ ] **Step 3: Implement procurement atomically**

Wrap receipt in `withTransaction`. For each item:

```js
const beforeQty = inventory.getBalance(productId); // aggregate company physical before receipt
const oldCost = product.cost_cents;
const receivedCost = orderItem.unit_cost_cents;
const newCost = beforeQty <= 0
  ? receivedCost
  : Math.round(((beforeQty * oldCost) + (receivedQty * receivedCost)) / (beforeQty + receivedQty));
inventory.move({productId,locationId:order.location_id,type:'purchase',quantityDelta:receivedQty,sourceType:'purchase-receipt',sourceId:receiptId}, actor);
db.prepare('UPDATE products SET cost_cents=?,updated_at=? WHERE id=?').run(newCost,now(),productId);
```

Create one payable per receipt (sum of receipt line values), `sourceType='PURCHASE_RECEIPT'`, `sourceId=receiptId`.

- [ ] **Step 4: Wire into runtime**

Construct `procurement` after `inventory` and `finance`, expose as `runtime.procurement`.

- [ ] **Step 5: Run focused and finance regression tests**

Run: `node --test test/procurement-service.test.js test/finance-service.test.js test/inventory-service.test.js`

- [ ] **Step 6: Commit**

```bash
git add js/domains/procurement/procurement-service.js js/core/pdv-runtime.js test/procurement-service.test.js
git commit -m "feat: add purchase orders and receiving"
```

---

### Task 5: Transferências com estoque em trânsito

**Files:**
- Modify: `js/domains/inventory-logistics/inventory-logistics-service.js`
- Create: `test/stock-transfer.test.js`

**Interfaces:**
- `createTransfer({fromLocationId,toLocationId,items},actor)`
- `dispatchTransfer(id,{idempotencyKey},actor)`
- `receiveTransfer(id,{idempotencyKey},actor)`
- `cancelTransfer(id,{reason},actor)`
- `getTransfer(id)` / `listTransfers(filters)`

- [ ] **Step 1: Write RED tests for DRAFT → IN_TRANSIT → RECEIVED**

```js
test('transfer removes origin on dispatch and adds destination only on receive', () => {
  seedLocation('B');
  seedStockAt('p','MAIN',10);
  const transfer = logistics.createTransfer({fromLocationId:'MAIN',toLocationId:'B',items:[{productId:'p',quantity:4}]},manager);
  logistics.dispatchTransfer(transfer.id,{idempotencyKey:'dispatch-1'},manager);
  assert.equal(inventory.getBalance('p',{locationId:'MAIN'}),6);
  assert.equal(inventory.getBalance('p',{locationId:'B'}),0);
  assert.equal(logistics.getTransfer(transfer.id).status,'IN_TRANSIT');
  logistics.receiveTransfer(transfer.id,{idempotencyKey:'receive-1'},manager);
  assert.equal(inventory.getBalance('p',{locationId:'B'}),4);
});
```

Also test same origin/destination rejection, insufficient availability, duplicate dispatch/receive no-op, and cancellation after dispatch rejected with explicit return-flow error.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/stock-transfer.test.js`

- [ ] **Step 3: Implement transfer state machine**

Dispatch uses `availableQuantity` at source, writes location `adjustment-out` movements with source `stock-transfer`, and persists dispatched timestamp/key. Receive writes `adjustment-in` at destination and received timestamp/key.

- [ ] **Step 4: Run focused inventory/logistics tests**

Run: `node --test test/stock-transfer.test.js test/inventory-logistics.test.js`

- [ ] **Step 5: Commit**

```bash
git add js/domains/inventory-logistics/inventory-logistics-service.js test/stock-transfer.test.js
git commit -m "feat: add stock transfers with in-transit state"
```

---

### Task 6: Orçamento, pedido, reserva, fulfillment e conversão em venda

**Files:**
- Create: `js/domains/orders/order-service.js`
- Modify: `js/domains/sales/sale-service.js`
- Modify: `js/core/pdv-runtime.js`
- Create: `test/order-service.test.js`

**Interfaces:**
- `createOrder({customerId,locationId='MAIN',fulfillmentType='PICKUP',expectedAt=null},actor)`
- `addItem(orderId,{productId,quantity,unitPriceCents},actor)`
- `quote(orderId,actor)`
- `confirm(orderId,actor)`
- `fulfill(orderId,{idempotencyKey,items,terminalId,operatorId,sellerId,payments},actor)`
- `cancel(orderId,{reason},actor)`
- `getOrder(id)` / `listOrders(filters)`

- [ ] **Step 1: Write RED tests for reservation and partial/full fulfillment**

```js
test('confirmed order reserves stock and fulfillment reuses SaleService', () => {
  seedStockAt('p','MAIN',10);
  const order = orders.createOrder({customerId:'cli',locationId:'MAIN',fulfillmentType:'PICKUP'},manager);
  orders.addItem(order.id,{productId:'p',quantity:6,unitPriceCents:1000},manager);
  orders.quote(order.id,manager);
  orders.confirm(order.id,manager);
  assert.equal(logistics.getAvailability('p','MAIN').availableQuantity,4);

  const first = orders.fulfill(order.id,{idempotencyKey:'f1',items:[{productId:'p',quantity:2}],terminalId:'T1',operatorId:'u1',payments:[{method:'CASH',amountCents:2000}]},manager);
  assert.equal(first.order.status,'PARTIALLY_FULFILLED');
  assert.ok(first.sale.id);
  const retry = orders.fulfill(order.id,{idempotencyKey:'f1',items:[{productId:'p',quantity:2}],terminalId:'T1',operatorId:'u1',payments:[{method:'CASH',amountCents:2000}]},manager);
  assert.equal(retry.sale.id,first.sale.id);
});
```

Also assert cancel releases active reservations and fulfillment cannot exceed remaining order quantity.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/order-service.test.js`

- [ ] **Step 3: Implement order state machine**

Confirmation creates one reservation per order item/source. `fulfill()` builds a normal sale:

```js
const sale = sales.openSale({
  terminalId, operatorId, sellerId: sellerId || operatorId,
  customerId: order.customer_id,
  stockLocationId: order.location_id,
  reservationSource:{type:'sales-order',id:order.id}
}, actor);
for (const item of fulfillmentItems) sales.addItem(sale.id,{productId:item.productId,quantity:item.quantity,unitPriceCents:item.unitPriceCents,forceSeparateLine:true});
const completed = sales.completeSale(sale.id,{payments,actor,mutationId:idempotencyKey,reservationSource:{type:'sales-order',id:order.id}});
```

Use fulfillment unique idempotency key to return the same sale on retry.

- [ ] **Step 4: Bind/consume only the fulfilled portion of reservations**

Reservation rows must track original quantity, consumed quantity and remaining active quantity so partial fulfillment leaves the remainder reserved. The inventory effect marks only the fulfilled quantity consumed after physical movement succeeds.

- [ ] **Step 5: Wire runtime and run sale/order regressions**

Run: `node --test test/order-service.test.js test/sale-service.test.js test/inventory-logistics.test.js test/return-service.test.js`

- [ ] **Step 6: Commit**

```bash
git add js/domains/orders/order-service.js js/domains/sales/sale-service.js js/core/pdv-runtime.js test/order-service.test.js
git commit -m "feat: add quotes orders and fulfillment"
```

---

### Task 7: HTTP API, desktop client e UI operacional

**Files:**
- Modify: `server/router.js`
- Modify: `desktop/renderer/api-client.js`
- Modify: `desktop/renderer/operational-pages.js`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/index.html`
- Create: `test/enterprise-depth-api.test.js`
- Create: `test/enterprise-depth-ui.test.js`

**Interfaces:**
- API: `/api/v1/stock-locations`, `/api/v1/inventory/availability`, `/api/v1/stock-reservations`, `/api/v1/stock-transfers`, `/api/v1/purchase-orders`, `/api/v1/purchase-receipts`, `/api/v1/sales-orders`, `/api/v1/sales-orders/:id/fulfillments`.
- Client methods mirror all operational API calls and always send `mutationId()` for retry-sensitive mutations.

- [ ] **Step 1: Write RED API tests**

Test admin/manager authorization, cashier read access where appropriate, 409/400 state errors, and mutation-id idempotency. Example:

```js
test('purchase receipt endpoint is manager-only and idempotent', async () => {
  const login = await loginAs('manager');
  const first = await post('/api/v1/purchase-receipts',{orderId:'po1',items:[{productId:'p',quantity:2}]},login,{mutationId:'receipt-1'});
  const second = await post('/api/v1/purchase-receipts',{orderId:'po1',items:[{productId:'p',quantity:2}]},login,{mutationId:'receipt-1'});
  assert.equal(first.payload.id,second.payload.id);
});
```

- [ ] **Step 2: Run API test and confirm RED**

Run: `node --test test/enterprise-depth-api.test.js`

- [ ] **Step 3: Add routes to the authenticated base router**

Keep the new routes in `server/router.js` so they reuse the existing session token and `requireRole()` rather than introducing a second auth store. Use `mutation()` for receipt, dispatch/receive and fulfillment mutations.

- [ ] **Step 4: Extend `ApiClient`**

Add exact helpers such as:

```js
stockLocations(){ return this.request('/api/v1/stock-locations'); }
inventoryAvailability(filters={}){ return this.request(`/api/v1/inventory/availability${this.params(filters)}`); }
purchaseOrders(filters={}){ return this.request(`/api/v1/purchase-orders${this.params(filters)}`); }
receivePurchase(body){ return this.request('/api/v1/purchase-receipts',{method:'POST',body,mutationId:this.mutationId()}); }
stockTransfers(filters={}){ return this.request(`/api/v1/stock-transfers${this.params(filters)}`); }
salesOrders(filters={}){ return this.request(`/api/v1/sales-orders${this.params(filters)}`); }
fulfillSalesOrder(id,body){ return this.request(`/api/v1/sales-orders/${encodeURIComponent(id)}/fulfillments`,{method:'POST',body,mutationId:this.mutationId()}); }
```

- [ ] **Step 5: Add UI surface tests before UI implementation**

`test/enterprise-depth-ui.test.js` must assert that renderer source exposes route markers/actions for:

- inventory location selector and physical/reserved/available columns;
- purchases/orders/receipts;
- logistics/transfer state and receive action;
- sales orders/quote/confirm/fulfill.

- [ ] **Step 6: Implement operational UI**

Extend `OPERATIONAL_ROUTES` with `purchases`, `logistics`, `orders`. Keep inventory on the existing page but add location selection and availability columns. Do not duplicate supplier/customer/product forms; use existing IDs/selectors from catalog APIs.

- [ ] **Step 7: Run API/UI tests and renderer lint**

Run: `node --test test/enterprise-depth-api.test.js test/enterprise-depth-ui.test.js && npm run lint:desktop && npm run lint:core`

- [ ] **Step 8: Commit**

```bash
git add server/router.js desktop/renderer test/enterprise-depth-api.test.js test/enterprise-depth-ui.test.js
git commit -m "feat: expose enterprise depth operations in API and UI"
```

---

### Task 8: Registry de capacidades, Fase 9, versão 1.4.0 e consistência documental

**Files:**
- Modify: `release/customer-capabilities.json`
- Modify: `release/capabilities.json`
- Modify: `release/e2e-coverage.json`
- Modify: `release/limitations.json`
- Modify: `scripts/check-customer-capability-parity.js` only if phase ceiling must accept 9 explicitly
- Modify: `scripts/check-docs-consistency.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md` only if the version rule needs documentation
- Create: `test/phase9-roadmap.test.js`
- Create: `test/docs-version-consistency.test.js`

**Interfaces:**
- New supported capability: `operations.enterprise-depth` (customer/admin surface).
- New phase: `9`, gate `test:release` + capability release gate.
- `capability:check:release` must use `--max-phase 9 --require-100`.

- [ ] **Step 1: Write RED roadmap and version consistency tests**

```js
test('phase 9 is release-blocking and registry-backed', () => {
  const coverage = require('../release/e2e-coverage.json');
  assert.equal(coverage.phases['9'].name,'Profundidade operacional');
  assert.equal(coverage.phases['9'].targetCoveragePercent,100);
});

test('official release docs cannot mention another commercial version', () => {
  const pkg = require('../package.json');
  const limitations = JSON.stringify(require('../release/limitations.json'));
  assert.equal(pkg.version,'1.4.0');
  assert.doesNotMatch(limitations,/vers[aã]o 1\.3\.2/i);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/phase9-roadmap.test.js test/docs-version-consistency.test.js`

- [ ] **Step 3: Update capability registry**

Declare `operations.enterprise-depth` with backend paths for procurement/logistics/orders, API `server/router.js`, client `desktop/renderer/api-client.js`, UI `desktop/renderer/operational-pages.js`, and E2E `qa/flows/enterprise-depth-p0.json`.

Add declared capabilities:

```json
[
  "historical-cost-snapshot",
  "stock-locations",
  "stock-availability-reservations",
  "procurement-purchase-receiving",
  "moving-average-cost",
  "payable-from-purchase",
  "stock-transfer-in-transit",
  "quote-order-fulfillment",
  "order-to-sale-integration"
]
```

- [ ] **Step 4: Add Phase 9 to `release/e2e-coverage.json`**

```json
"9": {
  "name": "Profundidade operacional",
  "gate": "test:release",
  "targetCoveragePercent": 100,
  "evidence": ["test/release/phase9-enterprise-depth.test.js","qa/flows/enterprise-depth-p0.json"],
  "covers": ["historical-cost-snapshot","stock-locations","stock-availability-reservations","procurement-purchase-receiving","moving-average-cost","payable-from-purchase","stock-transfer-in-transit","quote-order-fulfillment","order-to-sale-integration"]
}
```

- [ ] **Step 5: Version to 1.4.0 and strengthen docs check**

`check-docs-consistency.js` must compare `package.json.version` with README heading and reject stale explicit commercial version references in release limitations. Keep a narrowly-scoped regex so dates or dependency versions are not mistaken for app versions.

- [ ] **Step 6: Run docs/capability tests**

Run: `node --test test/phase9-roadmap.test.js test/docs-version-consistency.test.js && npm run docs:check && npm run capability:check:release`

Expected: 100% customer/admin registered capability coverage.

- [ ] **Step 7: Commit**

```bash
git add release scripts/check-docs-consistency.js scripts/check-customer-capability-parity.js package.json README.md CONTRIBUTING.md test/phase9-roadmap.test.js test/docs-version-consistency.test.js
git commit -m "chore: add phase 9 release gate and version 1.4.0"
```

---

### Task 9: Release integration gate da Fase 9

**Files:**
- Create: `test/release/phase9-enterprise-depth.test.js`
- Modify: `package.json` only if lint/test discovery needs the new service paths

**Interfaces:**
- Release child test executes real DB/services and verifies complete domain chain without mocked persistence.

- [ ] **Step 1: Write the release gate**

The test must create a real in-memory runtime and assert, in order:

```js
// 1 supplier/product/location
// 2 purchase order
// 3 partial receipt -> stock + payable + PARTIALLY_RECEIVED
// 4 retry partial receipt -> no duplicate stock/payable
// 5 final receipt -> RECEIVED
// 6 transfer -> IN_TRANSIT -> destination receipt
// 7 quote/order -> CONFIRMED -> reservation
// 8 competing sale fails because availability excludes reservation
// 9 partial fulfillment -> sale completed, reservation reduced
// 10 final fulfillment -> order FULFILLED
// 11 product cost changes
// 12 sales report still returns original cost snapshot
```

Use deterministic `now` and `idFactory` to make assertions stable.

- [ ] **Step 2: Run and confirm RED until all preceding interfaces exist**

Run: `node --test test/release/phase9-enterprise-depth.test.js`

- [ ] **Step 3: Resolve only integration defects revealed by the gate**

Do not broaden scope. Fix transaction ordering, idempotency or missing event payload fields required by the approved design.

- [ ] **Step 4: Run all release tests**

Run: `npm run test:release`

Expected: all prior Phase 5–8 gates plus Phase 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add test/release/phase9-enterprise-depth.test.js package.json js server desktop release
git commit -m "test: gate enterprise depth release flow"
```

---

### Task 10: Electron E2E, full verification, PR and merge readiness

**Files:**
- Create: `qa/flows/enterprise-depth-p0.json`
- Modify: `qa/artisys-qa.config.json` if flow registration is explicit
- Modify: `release/customer-capabilities.json` if final E2E path was not already committed

**Interfaces:**
- The flow must exercise actual renderer/API interaction for the user-visible subset, not merely static source assertions.

- [ ] **Step 1: Add a failing QA flow definition**

The flow must drive at minimum:

1. login manager/admin;
2. create/select supplier/product/secondary stock location;
3. create purchase order and receive partial quantity;
4. verify purchase status and inventory physical/available values in UI;
5. dispatch and receive transfer;
6. create/confirm customer order;
7. verify reserved/available stock in UI;
8. fulfill order and verify linked sale/history;
9. open sales report and verify historical margin survives current-cost edit.

- [ ] **Step 2: Validate flow schema**

Run: `npm run qa:validate`

Expected: PASS.

- [ ] **Step 3: Run focused release E2E**

Run the QA runtime against `qa/flows/enterprise-depth-p0.json` under Xvfb/CI profile, using the same Electron harness as `qa:release`.

Expected: PASS and evidence generated in `qa-artifacts`.

- [ ] **Step 4: Run fresh complete verification**

Run, in this order:

```bash
npm run verify:release
npm run qa:validate
npm run qa:release
```

Do not claim completion unless every command exits 0 on the final branch head.

- [ ] **Step 5: Inspect capability output**

Expected release capability output must show 100% for all supported customer/admin capabilities after `operations.enterprise-depth` is included.

- [ ] **Step 6: Commit final E2E evidence files**

```bash
git add qa release/customer-capabilities.json
git commit -m "test: add enterprise depth Electron release flow"
```

- [ ] **Step 7: Open PR**

PR title:

```text
Fase 9: profundidade operacional ERP/PDV 1.4.0
```

PR body must list:

- schema/migration compatibility;
- historical cost correction;
- locations/reservations/transfers;
- procurement/payables/moving average;
- quote/order/fulfillment;
- API/UI/E2E evidence;
- fresh `verify:release` and `qa:release` results.

- [ ] **Step 8: Wait for GitHub Actions on exact PR head SHA**

Require both `verify` and `e2e` jobs green on the exact final head. Inspect failed logs if either is red; do not merge on stale earlier green runs.

- [ ] **Step 9: Merge only after exact-head CI is green**

Merge the PR and fetch `main` again to confirm its new SHA points to the merge commit.

---

## Self-review result

- **Spec coverage:** every approved P0 section maps to Tasks 1–10; no spec requirement is left without an implementation/test owner.
- **Placeholder scan:** no `TBD`, `TODO`, “similar to” or unspecified error-handling steps remain.
- **Type consistency:** `locationId`, `stockLocationId`, source `{type,id}`, idempotency keys, order/receipt/transfer states and `cost_cents_snapshot` names are consistent across tasks.
- **Review Focus coverage:** legacy migration is tested in Task 1; retry in Tasks 4–6/9; reservation competition in Tasks 3/6/9; historical cost in Tasks 2/9/10; backward compatibility in Tasks 1/3 plus final full verification.
