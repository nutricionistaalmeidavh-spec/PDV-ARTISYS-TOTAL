# E28–E29 Pilot and Release 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o PDV implantável em campo com checklist persistente e fechar o release comercial ArtiSys PDV 1.0 com manifesto, documentação e gates reproduzíveis.

**Architecture:** O piloto é um domínio persistente que registra evidências reais e dependências externas sem falsos positivos. O release é gerado por script determinístico a partir de versão, commit, schema, capabilities, resultados de CI e checksums de artefatos.

**Tech Stack:** Node.js 22+, `node:sqlite`, Electron, GitHub Actions, SHA-256.

**Spec:** `docs/superpowers/specs/2026-09-09-e21-e29-design.md`

## Global Constraints

- `BLOCKED_EXTERNAL` é estado válido e não equivale a READY.
- Fiscal/hardware ausentes não podem ser simulados como aprovados.
- Release 1.0 requer `verify`, `verify:release` e build Windows verdes.
- Documentação não pode instruir reset destrutivo do banco.

---

### Task 1: Pilot checklist domain/API/UI

**Files:**
- Modify: `js/core/database/migrations.js`
- Create: `js/core/pilot/pilot-service.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `server/router.js`
- Modify: `desktop/renderer/api-client.js`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/operational-pages.css`
- Test: `test/e28-pilot.test.js`

**Interfaces:**
- `pilot.listChecks()`, `pilot.updateCheck(key,{status,note,evidence,actor})`, `pilot.readiness()`.
- States: `NOT_STARTED|IN_PROGRESS|READY|BLOCKED|BLOCKED_EXTERNAL`.
- API `GET /api/v1/pilot`, `PATCH /api/v1/pilot/:key`, `GET /api/v1/pilot/readiness`.

- [ ] **Step 1: Write failing tests** for initial checklist, transitions, external blocking and readiness calculation.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Add `pilot_checks` migration/service** seeded idempotently with required deployment checks.
- [ ] **Step 4: Add admin/manager API and deployment-readiness UI**.
- [ ] **Step 5: Verify and commit** `feat(pilot): add persistent field readiness checklist`.

### Task 2: Release manifest generator

**Files:**
- Create: `release/capabilities.json`
- Create: `release/limitations.json`
- Create: `scripts/generate-release-manifest.js`
- Create: `test/e29-release-manifest.test.js`
- Modify: `package.json`

**Interfaces:**
- `npm run release:manifest -- --output <path>` writes JSON with `version`, `commit`, `schemaVersion`, `builtAt`, `artifacts`, `checksums`, `verification`, `capabilities`, `limitations`.

- [ ] **Step 1: Write failing deterministic manifest test** with fixed env/time/artifact fixture.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement generator** reading package/schema/capability files and computing SHA-256 for supplied artifacts.
- [ ] **Step 4: Verify and commit** `build(release): add deterministic release manifest`.

### Task 3: Operations documentation and v1.0 metadata

**Files:**
- Create: `docs/operations/install-server.md`
- Create: `docs/operations/install-terminal.md`
- Create: `docs/operations/pairing.md`
- Create: `docs/operations/cash-sales-returns.md`
- Create: `docs/operations/backup-restore.md`
- Create: `docs/operations/hardware-printing.md`
- Create: `docs/operations/fiscal.md`
- Create: `docs/operations/import.md`
- Create: `docs/operations/diagnostics.md`
- Create/Update: `docs/operations/update.md`
- Modify: `README.md`
- Modify: `package.json`
- Test: `test/e29-docs-release.test.js`

**Interfaces:**
- Package version becomes exactly `1.0.0` only after functionality/tests are in place.

- [ ] **Step 1: Write failing docs/release test** asserting all manuals, version 1.0.0 and absence of stale “future delivery” placeholders.
- [ ] **Step 2: Write concise operational manuals** with explicit external dependency caveats.
- [ ] **Step 3: Update README state to E01–E29** and package version to 1.0.0.
- [ ] **Step 4: Verify and commit** `docs: prepare ArtiSys PDV 1.0 operations`.

### Task 4: Final release CI and merge gate

**Files:**
- Modify: `.github/workflows/verify.yml`
- Modify: `.github/workflows/release-windows.yml`
- Create: `release/release-checklist.md`

**Interfaces:**
- Ubuntu gate: `npm ci && npm run verify && npm run verify:release`.
- Windows gate: same release verification + `npm run dist:win` + manifest + SHA-256 artifact upload.

- [ ] **Step 1: Make CI run both normal and release gates on PR/main**.
- [ ] **Step 2: Run branch CI and Windows package workflow**.
- [ ] **Step 3: Inspect logs/artifact metadata; fix any blocker and rerun from final HEAD**.
- [ ] **Step 4: Merge only the verified final HEAD to `main`**.
- [ ] **Step 5: Re-run/observe `main` post-merge gates and create v1.0 release/tag only when all required gates are green**.
