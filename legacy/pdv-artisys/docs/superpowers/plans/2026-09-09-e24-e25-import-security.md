# E24–E25 Import, Security and Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implantar dados existentes com preview/validação/idempotência e tornar o PDV auditável e diagnosticável em campo.

**Architecture:** Importação é transacional e passa por serviços de domínio existentes. Observabilidade grava apenas dados sanitizados e oferece health detalhado e pacote ZIP de diagnóstico sem banco/segredos.

**Tech Stack:** Node.js 22+, `node:sqlite`, `xlsx` para leitura XLSX, `archiver` para ZIP de diagnóstico, Electron preload estreito.

**Spec:** `docs/superpowers/specs/2026-09-09-e21-e29-design.md`

## Global Constraints

- Preview obrigatório antes de commit de importação.
- Estoque inicial usa `InventoryService`, nunca update direto de saldo.
- Reprocessamento do mesmo batch não duplica dados.
- Logs/auditoria não contêm senha, token, segredo LAN ou payload fiscal sensível.

---

### Task 1: Import batches e parser CSV/XLSX

**Files:**
- Modify: `js/core/database/migrations.js`
- Create: `js/core/import/import-service.js`
- Test: `test/e24-import.test.js`

**Interfaces:**
- `createImportService({db,catalog,inventory,now,idFactory})`.
- `preview({type,format,content,collisionPolicy})` => `{batchId,rows,errors,summary}`.
- `commit(batchId,{actor})` => canonical batch result.

- [ ] **Step 1: Write failing tests** para CSV com BOM/`;`/`,`, normalização de SKU/documento, erro por linha, colisões `CREATE|UPDATE|SKIP`, batch repetido e estoque via ledger.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Add migrations** `import_batches` + `import_errors` com hash do conteúdo e status `PREVIEWED|COMMITTED|FAILED`.
- [ ] **Step 4: Implement parser/preview/commit**; XLSX usa adapter lazy `require('xlsx')`, CSV funciona sem XLSX.
- [ ] **Step 5: Verify GREEN and commit** `feat(import): add previewed idempotent data migration`.

### Task 2: Importação segura no desktop

**Files:**
- Create: `desktop/import-bridge.cjs`
- Modify: `desktop/preload.cjs`
- Modify: `desktop/main.cjs`
- Modify: `desktop/renderer/api-client.js`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/operational-pages.css`
- Modify: `server/router.js`
- Test: `test/e24-import-api.test.js`

**Interfaces:**
- Electron exposes only `imports.pickFile()` returning `{name,format,contentBase64}` after native file selection; no arbitrary path or filesystem methods.
- API `POST /api/v1/imports/preview`, `POST /api/v1/imports/:id/commit`, `GET /api/v1/imports/:id`.

- [ ] **Step 1: Write failing API/architecture tests**.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement narrow file picker and API** with admin/manager RBAC.
- [ ] **Step 4: Add Import section to Settings** with type, collision policy, preview table, errors and explicit commit.
- [ ] **Step 5: Verify and commit** `feat(import): connect desktop import workflow`.

### Task 3: Structured logging, audit query and system health

**Files:**
- Create: `js/core/observability/system-logger.js`
- Create: `js/core/observability/system-health.js`
- Modify: `js/core/database/migrations.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `server/router.js`
- Test: `test/e25-observability.test.js`

**Interfaces:**
- `logger.log({level,subsystem,message,correlationId,terminalId,context})`, `logger.list(filters)`.
- `health.snapshot()` => database/schema/outbox/effects/disk/backups/terminals/printing/fiscal/version.
- Audit endpoint reads existing `audit_log` only; no mutation.

- [ ] **Step 1: Write failing tests** proving secrets are redacted and health counts are real.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Add `system_logs` migration and sanitizer** sharing audit redaction patterns.
- [ ] **Step 4: Add `/api/v1/audit`, `/api/v1/system/logs`, `/api/v1/system/health`** with admin/manager RBAC.
- [ ] **Step 5: Verify and commit** `feat(observability): add sanitized logs audit and health`.

### Task 4: Diagnostic package

**Files:**
- Create: `js/core/observability/diagnostic-package.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `server/router.js`
- Modify: `desktop/preload.cjs`
- Modify: `desktop/main.cjs`
- Modify: `desktop/renderer/app.js`
- Test: `test/e25-diagnostics.test.js`

**Interfaces:**
- `diagnostics.createPackage({actor})` => `{id,fileName,sha256,size,createdAt}`.
- ZIP contains `manifest.json`, `health.json`, `settings-public.json`, `migrations.json`, `logs.json`; never SQLite or secret stores.

- [ ] **Step 1: Write failing tests** that inspect ZIP entries and assert forbidden strings/files are absent.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement package with `archiver`** into controlled diagnostics directory.
- [ ] **Step 4: Add admin endpoint and narrow desktop save/open action**.
- [ ] **Step 5: Verify full suite and commit** `feat(diagnostics): add safe support bundle`.
