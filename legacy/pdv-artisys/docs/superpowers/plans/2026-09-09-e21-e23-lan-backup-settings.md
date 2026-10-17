# E21–E23 LAN, Backup and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o PDV multi-terminal LAN, recuperável por backup/restore e configurável sem expor banco/segredos ao renderer.

**Architecture:** O servidor continua autoritativo. E21 adiciona registro/pareamento de terminal e deduplicação de mutations; E22 cria snapshots SQLite verificados e restore preparado para reinício; E23 persiste configuração pública tipada em SQLite e mantém segredos em `safeStorage` no Electron.

**Tech Stack:** Node.js 22+, `node:sqlite`, `node:http`, Electron 39, crypto/fs/path nativos.

**Spec:** `docs/superpowers/specs/2026-09-09-e21-e29-design.md`

## Global Constraints

- Desktop + LAN local; sem SaaS.
- SQLite somente no servidor autoritativo.
- Sem venda offline em terminal desconectado.
- Renderer sem Node/SQL/filesystem genérico.
- Migrations incrementais e não destrutivas.
- Segredos nunca em `app_settings`.

---

### Task 1: Schema v3 e serviços LAN

**Files:**
- Modify: `js/core/database/migrations.js`
- Create: `server/lan/terminal-registry.js`
- Create: `server/lan/mutation-coordinator.js`
- Test: `test/e21-lan.test.js`

**Interfaces:**
- Produces: `createTerminalRegistry({db,now,idFactory})` com `createPairingCode`, `pairTerminal`, `authenticateTerminal`, `listTerminals`, `setTerminalStatus`, `handshake`.
- Produces: `createMutationCoordinator({db,now})` com `execute({mutationId,method,path},handler)` e persistência de resposta canônica.

- [ ] **Step 1: Write the failing test** cobrindo código single-use/expirado, credencial armazenada por hash, terminal bloqueado e execução duplicada retornando a mesma resposta.
- [ ] **Step 2: Run test to verify it fails** com `node --test test/e21-lan.test.js`.
- [ ] **Step 3: Implement migration v3** com `terminals`, `pairing_codes`, `processed_mutations`, índices e constraints.
- [ ] **Step 4: Implement LAN services** usando `randomBytes`, `scryptSync`/`timingSafeEqual` e `Map` apenas para in-flight; resultado final fica em SQLite.
- [ ] **Step 5: Run test and full verify**.
- [ ] **Step 6: Commit** `feat(lan): add terminal pairing and mutation idempotency`.

### Task 2: Integrar LAN à API e desktop

**Files:**
- Modify: `js/core/pdv-runtime.js`
- Modify: `server/router.js`
- Modify: `server/start.js`
- Create: `desktop/terminal-credentials.cjs`
- Modify: `desktop/main.cjs`
- Modify: `desktop/preload.cjs`
- Modify: `desktop/renderer/api-client.js`
- Test: `test/e21-lan-api.test.js`

**Interfaces:**
- New endpoints: `POST /api/v1/lan/pairing-codes`, `POST /api/v1/lan/pair`, `GET /api/v1/lan/handshake`, `GET/PATCH /api/v1/terminals/:id`.
- Terminal headers are injected by Electron main process; renderer never sees terminal secret.

- [ ] **Step 1: Write failing API tests** para pareamento, login LAN autenticado, bloqueio de versão incompatível e double-submit.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Compose services in runtime/router** sem quebrar loopback existente.
- [ ] **Step 4: Add server-terminal/terminal desktop modes**; terminal remoto não abre SQLite local nem servidor embutido.
- [ ] **Step 5: Persist terminal credential encrypted with `safeStorage`** and inject only in main-process HTTP proxy.
- [ ] **Step 6: Verify GREEN and commit** `feat(lan): connect paired desktop terminals`.

### Task 3: Backup/restore verificado

**Files:**
- Create: `js/core/backup/backup-service.js`
- Create: `js/core/backup/pending-restore.js`
- Modify: `js/core/database/migrations.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `server/router.js`
- Modify: `desktop/main.cjs`
- Test: `test/e22-backup.test.js`

**Interfaces:**
- `createBackupService({db,dbPath,backupDir,now,appVersion,retention})` => `createBackup`, `listBackups`, `validateBackup`, `prepareRestore`, `pruneBackups`, `getBackupStatus`.
- `applyPendingRestore({dbPath,backupDir})` runs before opening runtime and atomically replaces only after SHA-256 + `PRAGMA integrity_check` + schema check.

- [ ] **Step 1: Write failing tests** para backup válido, checksum inválido rejeitado, retenção e restore preparado sem tocar no banco ativo antes de reinício.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Add `backup_records` migration and SQLite `VACUUM INTO` snapshot** plus manifest SHA-256.
- [ ] **Step 4: Implement pre-restore snapshot + pending marker + startup atomic apply**.
- [ ] **Step 5: Add admin API** `/api/v1/backups/*`; Electron relaunches after accepted restore.
- [ ] **Step 6: Verify GREEN and commit** `feat(backup): add validated backup and safe restore`.

### Task 4: Configurações operacionais

**Files:**
- Create: `js/core/settings/settings-service.js`
- Modify: `js/core/database/migrations.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `server/router.js`
- Modify: `desktop/renderer/api-client.js`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/operational-pages.css`
- Test: `test/e23-settings.test.js`

**Interfaces:**
- `settings.get(key,{scope})`, `settings.list({scope,prefix})`, `settings.set(key,value,{scope,actor})`.
- API `GET /api/v1/settings`, `PUT /api/v1/settings/:key`.

- [ ] **Step 1: Write failing tests** de tipos JSON, escopo, RBAC e sanitização de chaves secretas.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement `app_settings` migration/service**; reject keys matching password/token/secret/authorization/fiscal credential.
- [ ] **Step 4: Implement real Settings UI sections** Geral, Rede, Caixa, Hardware, Impressão, Fiscal público, Backup, Segurança e Sobre.
- [ ] **Step 5: Verify full suite and commit** `feat(settings): add operational configuration center`.
