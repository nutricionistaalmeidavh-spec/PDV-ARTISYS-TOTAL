# E26–E27 QA and Windows Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar E01–E25 em Release Candidate verificável e produzir instalador Windows reproduzível para perfis Servidor+Terminal e Terminal.

**Architecture:** A suíte rápida continua em `npm run verify`; cenários pesados vão para `verify:release`. O desktop passa a ter bootstrap por perfil sem mover dados para o diretório de instalação. Electron Builder gera NSIS x64 e o CI Windows publica artefato com checksum.

**Tech Stack:** Node.js 22+, node:test, Electron 39, electron-builder, GitHub Actions Windows/Ubuntu.

**Spec:** `docs/superpowers/specs/2026-09-09-e21-e29-design.md`

## Global Constraints

- Atualização nunca apaga banco, backup ou credenciais.
- Nenhum reset por mudança de versão.
- Terminal remoto não abre SQLite local.
- `verify:release` deve ser determinístico e não depender de hardware/fiscal externo.

---

### Task 1: Release QA suite

**Files:**
- Create: `test/release/concurrency-release.test.js`
- Create: `test/release/recovery-release.test.js`
- Create: `test/release/security-release.test.js`
- Create: `scripts/run-release-tests.js`
- Modify: `package.json`

**Interfaces:**
- `npm run verify:release` runs the full normal verification plus release-only integration tests.

- [ ] **Step 1: Write failing release tests** for same-stock concurrent sales, duplicate completion, two terminal auth flows, outbox restart, return race, backup corruption/restore, repeated import and renderer isolation.
- [ ] **Step 2: Run targeted release tests and confirm RED where contracts are missing**.
- [ ] **Step 3: Fix only product defects exposed by the tests**; do not weaken assertions.
- [ ] **Step 4: Add `verify:release` script** and ensure `npm run verify` remains fast.
- [ ] **Step 5: Commit** `test(release): add operational RC gates`.

### Task 2: Desktop deployment profiles

**Files:**
- Create: `desktop/bootstrap-config.cjs`
- Modify: `desktop/main.cjs`
- Modify: `desktop/preload.cjs`
- Modify: `desktop/renderer/app.js`
- Test: `test/e27-bootstrap.test.js`

**Interfaces:**
- Profile enum: `server-terminal | terminal`.
- `loadBootstrapConfig(userData)` and `saveBootstrapConfig(userData,config)` expose only validated public bootstrap metadata; terminal credential remains in encrypted secret store.

- [ ] **Step 1: Write failing tests** for first run, invalid profile/server URL and persistence outside installation directory.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement bootstrap config and first-run profile wizard**.
- [ ] **Step 4: Ensure server-terminal starts embedded runtime and terminal only connects/pairs with LAN server**.
- [ ] **Step 5: Verify and commit** `feat(desktop): add server and terminal deployment profiles`.

### Task 3: Windows installer

**Files:**
- Modify: `package.json`
- Create: `build/installer.nsh`
- Create binary: `build/icon.png`
- Create: `.github/workflows/release-windows.yml`
- Test: `test/e27-package-config.test.js`

**Interfaces:**
- Scripts: `pack:win`, `dist:win`.
- Expected artifact: `ArtiSys-PDV-1.0.0-Setup-x64.exe` (version is finalized by E29).

- [ ] **Step 1: Write failing config test** asserting `appId`, NSIS target x64, data-preserving uninstall policy and output naming.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Add `electron-builder` configuration/dependency and ArtiSys app icon**.
- [ ] **Step 4: Add Windows workflow**: checkout, Node 22, `npm ci`, `npm run verify:release`, `npm run dist:win`, SHA-256, upload artifacts.
- [ ] **Step 5: Run PR Windows CI and inspect artifact/checksum**.
- [ ] **Step 6: Commit** `build: add reproducible Windows installer pipeline`.

### Task 4: Update/recovery smoke

**Files:**
- Create: `scripts/pre-update-check.js`
- Create: `test/release/update-release.test.js`
- Modify: `docs/operations/update.md`

**Interfaces:**
- `npm run preupdate:check` creates/validates pre-update backup, checks schema compatibility and exits non-zero if unsafe.

- [ ] **Step 1: Write failing smoke test** from previous schema/database fixture.
- [ ] **Step 2: Implement pre-update safety check** without destructive actions.
- [ ] **Step 3: Verify migrations preserve data and rollback instructions are executable**.
- [ ] **Step 4: Commit** `build: add safe update preflight`.
