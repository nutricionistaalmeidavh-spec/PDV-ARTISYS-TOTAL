# Integrity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar caixa, devoluções, estoque/ficha técnica, RBAC vertical e configuração de servidor historicamente determinísticos e seguros.

**Architecture:** A venda e a devolução passam a persistir referências imutáveis da sessão de caixa e valores líquidos. O evento de venda carrega o snapshot de consumo de estoque, e efeitos assíncronos deixam de consultar estado mutável para reconstruí-lo. A configuração de servidor persiste somente dados não secretos; a credencial fica no `safeStorage` existente e o teste de conexão valida servidor e terminal.

**Tech Stack:** Node.js 22, Electron, SQLite/better-sqlite3, node:test.

**Spec:** solicitação do usuário de 2026-10-01 para implementar os sete itens priorizados na revisão aprofundada.

## Global Constraints

- Operação principal deve continuar disponível sem dependência paga obrigatória.
- Não criar fallback silencioso de terminal externo para base local.
- Preservar compatibilidade de instalações SQLite existentes por migração idempotente.
- Segredos de terminal não podem permanecer em `data-server.json`.

## Review Focus

- Retry de evento depois do fechamento do caixa deve continuar apontando para a sessão original.
- Alteração de ficha técnica depois da venda não pode mudar o consumo daquela venda/devolução.
- Desconto global precisa resultar em devolução pelo valor líquido, inclusive com devoluções parciais.
- Cashier não pode alcançar APIs verticais que o catálogo de módulos não lhe concede.
- Instalação com dados financeiros/operacionais, mesmo sem vendas/produtos/clientes, não pode trocar silenciosamente para servidor externo.

---

### Task 1: Snapshot financeiro e operacional da venda/devolução

**Files:**
- Modify: `js/core/database/sales-enhancement-migrations.js`
- Modify: `js/domains/sales/pricing.js`
- Modify: `js/domains/sales/sale-service.js`
- Modify: `js/domains/cash/cash-service.js`
- Modify: `js/domains/cash/cash-effects.js`
- Modify: `js/domains/returns/return-service.js`
- Modify: `js/domains/returns/return-effects.js`
- Modify: `js/domains/inventory/item-stock-expander.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `desktop/renderer/returns-ui.js`
- Test: `test/integrity-hardening.test.js`

**Interfaces:**
- Produces: `sales.cash_session_id`, `return_transactions.cash_session_id`, `sale_items.allocated_discount_cents`, `sale_items.net_total_cents`.
- Produces: eventos `sale.completed`, `sale.cancelled`, `return.completed`, `return.cancelled` com `cashSessionId` e snapshots de estoque.

- [ ] Escrever testes que falham para caixa imutável, valor líquido e ficha técnica congelada.
- [ ] Implementar migração idempotente e alocação determinística do desconto.
- [ ] Persistir `cashSessionId` e snapshots no fechamento da venda/devolução.
- [ ] Fazer efeitos usarem snapshots/referências persistidos, nunca o caixa/ficha atual.
- [ ] Atualizar UI de devolução para exibir/calcular o valor líquido devolvível.
- [ ] Rodar suíte completa.

### Task 2: RBAC vertical no servidor

**Files:**
- Modify: `js/core/modules/module-service.js`
- Modify: `server/vertical-router.js`
- Test: `test/vertical-rbac-hardening.test.js`

**Interfaces:**
- Produces: `modules.requireAccess(moduleId, actor)` e `modules.requireManage(moduleId, actor)`.

- [ ] Escrever teste HTTP que diferencia cashier, manager e admin.
- [ ] Aplicar `accessRoles` nas operações do módulo e `manageRoles` em configuração administrativa.
- [ ] Proteger ficha técnica e customização genérica no mínimo para manager/admin.
- [ ] Rodar testes verticais e suíte completa.

### Task 3: Origem de dados e credencial do terminal

**Files:**
- Modify: `desktop/data-server-config.cjs`
- Create: `desktop/data-server-runtime.cjs`
- Modify: `desktop/main.cjs`
- Modify: `desktop/renderer/app.js` ou integração equivalente do formulário
- Test: `test/data-server-hardening.test.js`
- Test: `test/data-server-config.test.js`

**Interfaces:**
- Produces: `localBusinessDataSummary(db)`, `saveDataServerSelection(...)`, `migrateLegacyDataServerCredential(...)`, `testDataServerTarget(...)`.

- [ ] Escrever testes para dados financeiros, segredo fora do JSON e credencial inválida.
- [ ] Bloquear troca externa quando qualquer dado operacional relevante existir.
- [ ] Migrar chave legada do JSON para `terminalCredentialStore` e persistir arquivo sanitizado.
- [ ] Validar `/health` e uma rota autenticada por terminal antes de confirmar conexão.
- [ ] Rodar lint desktop e suíte completa.
