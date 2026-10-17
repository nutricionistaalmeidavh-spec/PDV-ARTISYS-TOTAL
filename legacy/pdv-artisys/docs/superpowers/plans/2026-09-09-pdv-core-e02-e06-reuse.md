# PDV ArtiSys Core E02–E06 Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o núcleo operacional E02–E06 do PDV ArtiSys reutilizando regras maduras do PDVNexus e padrões de infraestrutura do CLINICASMEDICAS, sem depender da UI final.

**Architecture:** Um serviço Node local é a única autoridade de escrita sobre SQLite (`node:sqlite`). Terminais acessam `/api/v1` por HTTP LAN. Regras de negócio ficam em módulos puros; persistência ocorre em repositórios transacionais; eventos canônicos são gravados na outbox e efeitos derivados são idempotentes via EventBus.

**Tech Stack:** Node.js 22+, `node:sqlite`/`DatabaseSync`, CommonJS, `node:http`, `node:test`, EventBus já presente no repositório.

**Spec:** `docs/superpowers/specs/2026-09-09-pdv-core-e02-e06-design.md`

## Global Constraints

- Desktop/local-first e LAN; nenhuma dependência de SaaS/web.
- Banco SQLite somente no processo servidor; nunca abrir o arquivo por SMB/share.
- Dinheiro persistido e calculado em centavos inteiros.
- Quantidades de estoque normalizadas a 3 casas decimais.
- Toda mutação crítica usa transação explícita.
- `sale.completed` e `sale.cancelled` entram na outbox antes do commit.
- Efeitos críticos usam `eventId + effectKey` para idempotência.
- Reutilizar regras do `PDVNexus/windows-10/packages/database/src/pdv.ts`, convertendo floats para centavos e removendo baixa direta de estoque de `completePdvSale`.
- Reutilizar padrão de `node:sqlite` e HTTP local de `PDVNexus/windows-10/apps/nexus-desktop/main.cjs`, sem o reset destrutivo por versão e sem snapshot JSON como fonte primária.
- Reutilizar padrão versionado de migrations e sanitização de auditoria do `CLINICASMEDICAS`, adaptado ao domínio PDV.

---

### Task 1: Utilitários monetários e regras PDV reutilizadas

**Files:**
- Create: `js/domains/shared/money.js`
- Create: `js/domains/payments/payment-rules.js`
- Test: `test/payment-rules.test.js`

**Interfaces:**
- Produces: `toCents(value)`, `formatCents(cents)`, `resolvePayment({totalCents,payments,availableCreditCents,creditMethods,changeMethods})`.

- [ ] Escrever testes que cobrem pagamento insuficiente, pagamento misto, troco apenas em dinheiro, crédito acima do limite e rejeição de centavos inválidos.
- [ ] Executar `node --test test/payment-rules.test.js` e confirmar falha por módulos ausentes.
- [ ] Portar a lógica de `resolvePdvPayment`, substituindo floats por inteiros em centavos.
- [ ] Executar o teste e confirmar PASS.

### Task 2: SQLite, migrations, outbox e auditoria

**Files:**
- Create: `js/core/database/sqlite-database.js`
- Create: `js/core/database/migrations.js`
- Create: `js/core/database/outbox-store.js`
- Create: `js/core/database/effect-store.js`
- Create: `js/core/audit-log.js`
- Test: `test/database.test.js`

**Interfaces:**
- Produces: `openDatabase(path)`, `runMigrations(db)`, `withTransaction(db, fn)`, `SqliteOutboxStore`, `SqliteEffectStore`, `sanitizeAuditPayload`, `writeAudit`.

- [ ] Escrever testes em banco `:memory:` para schema, migrations idempotentes, foreign keys, WAL/busy timeout quando aplicável, outbox pendente/despachada, effect key única e sanitização de segredos.
- [ ] Rodar teste e confirmar RED.
- [ ] Implementar schema E02: migrations, users, categories, products, customers, suppliers, inventory_balances, inventory_movements, sales, sale_items, payments, cash_sessions, cash_movements, audit_log, domain_events, domain_event_effects.
- [ ] Confirmar PASS e que uma segunda execução de migrations não altera versão nem apaga dados.

### Task 3: Cadastros E03

**Files:**
- Create: `js/domains/catalog/catalog-service.js`
- Test: `test/catalog-service.test.js`

**Interfaces:**
- Produces: `createCatalogService({db})` com `upsertCategory`, `upsertProduct`, `getProduct`, `listProducts`, `upsertCustomer`, `getCustomer`, `upsertSupplier`, `createUser`, `getUser`.

- [ ] Escrever testes para SKU/barcode únicos, normalização de documento, valores em centavos, soft delete/ativo e roles `admin|manager|cashier`.
- [ ] Rodar RED.
- [ ] Implementar serviço usando statements parametrizados e auditoria.
- [ ] Rodar PASS.

### Task 4: Estoque E04

**Files:**
- Create: `js/domains/inventory/inventory-rules.js`
- Create: `js/domains/inventory/inventory-service.js`
- Create: `js/domains/inventory/inventory-effects.js`
- Test: `test/inventory-service.test.js`

**Interfaces:**
- Produces: `roundQuantity`, `applyStockDelta`, `createInventoryService({db,bus,effectStore})`, `registerInventoryEffects(...)`.

- [ ] Portar testes equivalentes a `applyPdvStockMovement` e `applyPdvInventoryCount`: entrada, ajuste, contagem, bloqueio de estoque negativo e alerta mínimo.
- [ ] Rodar RED.
- [ ] Implementar movimentos imutáveis + projeção `inventory_balances`.
- [ ] Registrar efeito idempotente `inventory.sale-completed` que baixa os itens do payload do evento.
- [ ] Registrar efeito idempotente `inventory.sale-cancelled` que repõe itens.
- [ ] Confirmar retry do mesmo evento sem dupla baixa/reposição e PASS.

### Task 5: Motor de vendas E05

**Files:**
- Create: `js/domains/sales/pricing.js`
- Create: `js/domains/sales/sale-service.js`
- Test: `test/sale-service.test.js`

**Interfaces:**
- Produces: `calculateSaleTotals`, `createSaleService({db,outbox,now,idFactory})` com `openSale`, `addItem`, `updateItemQuantity`, `removeItem`, `applyDiscount`, `suspendSale`, `resumeSale`, `completeSale`, `cancelSale`, `getSale`.

- [ ] Escrever testes para estados OPEN/SUSPENDED/COMPLETED/CANCELLED, preços recalculados no servidor, descontos, múltiplos pagamentos, transação e cancelamento.
- [ ] Rodar RED.
- [ ] Portar regras maduras de `completePdvSale` e `cancelPdvSale`, retirando mutação direta de estoque.
- [ ] `completeSale` deve gravar `sale.completed` com itens/pagamentos dentro da mesma transação.
- [ ] `cancelSale` deve exigir motivo, não apagar histórico e gravar `sale.cancelled`.
- [ ] Confirmar PASS.

### Task 6: Caixa e pagamentos E06

**Files:**
- Create: `js/domains/cash/cash-rules.js`
- Create: `js/domains/cash/cash-service.js`
- Test: `test/cash-service.test.js`

**Interfaces:**
- Produces: `calculateCashClosing`, `createCashService({db,outbox,now,idFactory})` com `openSession`, `addSupply`, `withdraw`, `recordSalePayments`, `closeSession`, `getOpenSession`.

- [ ] Portar testes de `closePdvCashSession` para centavos: saldo inicial, suprimento, sangria, vendas por método, contado, divergência e fechamento balanceado/divergente.
- [ ] Rodar RED.
- [ ] Implementar apenas uma sessão OPEN por terminal; movimentos imutáveis e auditoria.
- [ ] Gravar `cash-session.opened` e `cash-session.closed` na outbox.
- [ ] Confirmar PASS.

### Task 7: Dispatcher integrado e fluxo ponta a ponta

**Files:**
- Create: `js/core/pdv-runtime.js`
- Test: `test/pdv-runtime.integration.test.js`

**Interfaces:**
- Produces: `createPdvRuntime({dbPath, now, idFactory})` e `runtime.dispatchPending()`.

- [ ] Escrever integração: migrar DB -> cadastrar produto -> entrada estoque -> abrir caixa -> abrir venda -> adicionar item -> pagar -> concluir -> despachar -> estoque baixar -> cancelar -> despachar -> estoque voltar -> fechar caixa -> reabrir o mesmo DB preservando estado.
- [ ] Rodar RED.
- [ ] Compor Database, EventBus, stores e serviços; registrar efeitos de estoque.
- [ ] Confirmar que evento com subscriber falhando fica pendente e que retry não repete efeito já aplicado.
- [ ] Confirmar PASS.

### Task 8: Servidor LAN `/api/v1`

**Files:**
- Create: `server/local-server.js`
- Create: `server/router.js`
- Test: `test/local-server.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `createLocalServer({runtime,host,port,token})` com `start()` e `stop()`.

- [ ] Escrever testes para `/api/v1/health`, autenticação por bearer token, limite de body, JSON inválido e rotas mínimas de products, inventory, cash e sales.
- [ ] Rodar RED.
- [ ] Adaptar o servidor `node:http` do PDVNexus para rotas versionadas, CORS restrito/sem wildcard por padrão, métodos REST adequados e tratamento consistente de erros.
- [ ] Implementar mutações com `x-mutation-id`/request context quando informado.
- [ ] Confirmar PASS.

### Task 9: Verificação final E02–E06

**Files:**
- Modify: `README.md`
- Create: `docs/architecture/core-e02-e06.md`

- [ ] Rodar `node --test test/*.test.js`.
- [ ] Rodar `node --check` em todos os arquivos JS novos.
- [ ] Executar smoke test em arquivo SQLite temporário com start/stop/restart do servidor.
- [ ] Documentar o que foi reutilizado e quais partes antigas foram deliberadamente descartadas.
- [ ] Confirmar critérios da spec um a um e registrar qualquer limitação restante sem mascará-la.
