# Crosscut All Optional Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar aos nove módulos opcionais do ArtiSys cobertura transversal real de estado ON/OFF, launcher/workspace, rejeição backend quando desativado e convergência automática do renderer.

**Architecture:** Reaproveitar o gate já criado para Restaurante, generalizando-o para um mapa de estados de módulos no renderer e um evento único de sincronização. O `qa:crosscut` continuará data-driven: `module-registry.js` é a fonte canônica; `qa/crosscut/modules.json` passa a declarar probes e superfícies reais para todos os módulos; flows E2E exercitam cada módulo sem criar dados permanentes quando o módulo está desligado.

**Tech Stack:** Node.js 22, Electron, Playwright/ArtiSys QA runtime, JSON QA flows, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-25-qa-crosscut-hardening-design.md`

## Global Constraints

- Core obrigatório continua local-first/self-hosted/open source e sem dependência paga.
- `module-registry.js` permanece a fonte de verdade dos IDs e dependências.
- Nenhum módulo pode ser marcado como coberto sem probe executável e superfície real de UI.
- `qa:quick` permanece barato; expansão transversal roda em `qa:crosscut`, `full` e `release`.
- Falha inesperada de console, request ou HTTP 5xx continua bloqueante.
- Mudança externa de módulo deve convergir sem reload manual.

## Review Focus

- Módulo desativado enquanto seu workspace está aberto deve sair da tela operacional sem deixar ação stale utilizável.
- Alteração externa deve convergir em até o timeout do crosscut, sem depender de clicar novamente em “Gerenciar módulos”.
- `WORKSHOP` deve preservar a dependência declarada de `SERVICES`; os testes não podem falsear a cobertura ignorando essa relação.
- Probe backend deve ser não destrutivo e retornar `MODULE_DISABLED`/409 quando o módulo está OFF.
- Compatibilidade do gate existente de Restaurante (`PdvRestaurantModuleGate`) deve ser preservada.

---

### Task 1: Fechar contrato declarativo dos nove módulos

**Files:**
- Modify: `qa/crosscut/modules.json`
- Modify: `test/module-crosscut-contracts.test.js`

**Interfaces:**
- Consumes: `buildModuleContractPlan({modules,probes})`.
- Produces: metadata para cada módulo com `critical`, `launcherSelector`, `protectedProbe`, `supportsLiveSync`, `workspaceSelector` e `workspaceHeading`.

- [ ] **Step 1: Write the failing test**
  Exigir `covered` para launcher, protected probe e live-sync nos 9 IDs; `coverage.covered===9`, `coverage.uncoveredCritical===0`; validar `WORKSHOP.dependsOn=['SERVICES']`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test test/module-crosscut-contracts.test.js`
  Expected: FAIL porque 8 módulos ainda estão `not-applicable`.
- [ ] **Step 3: Populate executable probe metadata**
  Usar superfícies seguras: PIZZERIA profile lookup; DELIVERY list; FAST_FOOD list; MARKET_BAKERY price-weight read/compute; RETAIL variant search; SERVICES commission report; WORKSHOP missing-order lookup; SELF_SERVICE missing-device context; RESTAURANT tables.
- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test test/module-crosscut-contracts.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "test(qa): require crosscut probes for every module"`

### Task 2: Generalizar sincronização de módulos no renderer

**Files:**
- Modify: `desktop/renderer/restaurant-module-gate.js`
- Modify: `test/restaurant-module-sync.test.js`
- Modify: `test/restaurant-new-table-ui.test.js`

**Interfaces:**
- Produces: `window.PdvModuleGate.refresh()`, `setEnabled(id, enabled)`, `isEnabled(id)`, `snapshot()` e evento `artisys:modules-state-changed`.
- Compatibility: `window.PdvRestaurantModuleGate` continua existindo e delega para `RESTAURANT`.

- [ ] **Step 1: Write failing regression tests**
  Exigir mapa multi-módulo, wrapper genérico de `saveSetting`, polling/focus/visibility, evento de mudança e alias legado do Restaurante.
- [ ] **Step 2: Run tests and confirm RED**
  Run: `node --test test/restaurant-module-sync.test.js test/restaurant-new-table-ui.test.js`
- [ ] **Step 3: Implement generic state gate**
  Atualizar todos os módulos retornados por `api.modules()`, aplicar proteção imediata a launchers conhecidos e emitir snapshot somente quando o estado mudar; em erro inicial, fail closed para Restaurante sem inventar estados dos demais módulos.
- [ ] **Step 4: Run focused tests and confirm GREEN**
- [ ] **Step 5: Commit**
  `git commit -m "feat(renderer): sync optional module state generically"`

### Task 3: Fazer launchers/workspaces convergirem ao estado externo

**Files:**
- Modify: `desktop/renderer/vertical-modules.js`
- Modify: `desktop/renderer/e48-e54-ui.js`
- Create: `test/module-workspace-sync.test.js`

**Interfaces:**
- Consumes: `artisys:modules-state-changed` and `PdvModuleGate`.
- Produces: `data-module-workspace="<ID>"` nos workspaces e cards re-renderizados a partir do snapshot atualizado.

- [ ] **Step 1: Write failing tests**
  Exigir listener do evento, atualização de `modules`, re-render do card de Configurações e marcação de todos os oito workspaces não-Restaurante.
- [ ] **Step 2: Run test and confirm RED**
- [ ] **Step 3: Implement workspace convergence**
  Ao receber estado externo, atualizar cards imediatamente; se o workspace ativo ficar OFF, navegar para `settings`; cards desativados não ficam clicáveis durante convergência.
- [ ] **Step 4: Run focused tests and confirm GREEN**
- [ ] **Step 5: Commit**
  `git commit -m "feat(renderer): reconcile vertical workspaces with module state"`

### Task 4: Adicionar E2E transversal para cada módulo

**Files:**
- Create: `qa/flows/pizzeria-module-sync-e2e.json`
- Create: `qa/flows/delivery-module-sync-e2e.json`
- Create: `qa/flows/fast-food-module-sync-e2e.json`
- Create: `qa/flows/market-bakery-module-sync-e2e.json`
- Create: `qa/flows/retail-module-sync-e2e.json`
- Create: `qa/flows/services-module-sync-e2e.json`
- Create: `qa/flows/workshop-module-sync-e2e.json`
- Create: `qa/flows/self-service-module-sync-e2e.json`
- Modify: `qa/artisys-qa.config.json`
- Modify: `test/qa-crosscut-ci.test.js`

**Interfaces:**
- Each flow: enable module externally → open Settings/module manager → launcher visible → disable externally → launcher hidden → protected probe returns 409 → re-enable → launcher restored → workspace opens with expected heading.
- `WORKSHOP`: ensure `SERVICES` enabled before enabling Workshop and restore no invalid dependency state.

- [ ] **Step 1: Write failing config/flow tests**
  Exigir que `crosscut.flows` contenha os nove flows e que cada flow tenha disable/probe/reenable/navigation assertions.
- [ ] **Step 2: Run and confirm RED**
- [ ] **Step 3: Add the eight flows and register them as critical `state-sync`**
- [ ] **Step 4: Run unit/config tests and confirm GREEN**
- [ ] **Step 5: Commit**
  `git commit -m "test(e2e): cover state sync for all optional modules"`

### Task 5: Release evidence and full verification

**Files:**
- Modify: `release/e2e-coverage.json`
- Modify: `CONTRIBUTING.md`
- Modify: `README.md` only if current QA documentation requires the module matrix note.

**Interfaces:**
- Produces: release evidence naming all 9 module crosscut flows and operational guidance for adding future modules.

- [ ] **Step 1: Add release-regression assertion**
  Extend existing QA integration/release test so the evidence file must enumerate all module state-sync flows.
- [ ] **Step 2: Confirm RED**
- [ ] **Step 3: Update release evidence/docs**
- [ ] **Step 4: Verify branch**
  Run in CI: `npm run verify:release`, `xvfb-run -a npm run qa:crosscut`, existing 1366×768 UX flows and fiscal certification.
  Expected: all required jobs PASS with zero missing critical module coverage.
- [ ] **Step 5: Review diff and open PR**
  Confirm no paid dependency, no reduction of existing gates, no unrelated refactor, then create PR to `main`.
