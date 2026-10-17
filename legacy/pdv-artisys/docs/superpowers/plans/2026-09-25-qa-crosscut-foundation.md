# QA Cross-Cutting Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar invariantes transversais do PDV executáveis como um gate `qa:crosscut`, integrando saúde de renderer/rede, contratos de módulos opcionais e regressões estruturais de UX ao ArtiSys QA existente.

**Architecture:** O ArtiSys QA continua sendo o único runtime E2E. Um `crosscut-runner` genérico executa contracts registrados, normaliza `checks/findings/coverage/evidence` e entrega tudo ao `product-report`, que passa a decidir o gate. O PDV fornece configuração/probes de módulos e o `ui-sweep` fornece findings estruturais; `profile-runner` apenas orquestra as capacidades habilitadas pelo perfil.

**Tech Stack:** Node.js 22, Electron 39, Playwright 1.63, SQLite, `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-25-qa-crosscut-hardening-design.md`

## Global Constraints

- Core obrigatório R$ 0, self-hosted/open source; nenhum SaaS pago como dependência.
- Reutilizar `qa/runtime`; não criar um segundo framework de QA.
- Renderer não substitui enforcement de backend.
- `quick` permanece barato; profundidade maior entra em `full`/`release`.
- Falha do harness em check crítico é falha, não skip silencioso.
- Sem sleeps arbitrários quando existir condição observável.
- Artifacts/evidence devem ser preservados para falhas relevantes.
- Overrides de gate exigem motivo explícito e auditável.

## Review Focus

- Mudança externa de módulo durante sessão ativa deve convergir sem restart e nunca navegar silenciosamente para tela não relacionada; Task 3 adiciona teste de matriz/probe para isso.
- Overlay/modal legítimo não deve ser classificado como overlap crítico; Task 4 adiciona teste geométrico para contenção/overlay permitido.
- Request failure esperado por teste/fault marcado como esperado não deve bloquear o product gate; Task 2 adiciona normalização/teste dessa distinção.
- Contract não aplicável deve aparecer em coverage com motivo, sem virar PASS falso nem blocker indevido; Tasks 1 e 3 fixam esse comportamento.
- Erro interno do próprio crosscut runner deve produzir finding crítico `qa-harness-error`; Task 1 adiciona teste explícito.

---

### Task 1: Crosscut result model and runner

**Files:**
- Create: `qa/runtime/src/crosscut-runner.js`
- Modify: `qa/runtime/src/index.js`
- Modify: `qa/runtime/package.json`
- Create: `test/qa-crosscut-runner.test.js`

**Interfaces:**
- Consumes: contracts com assinatura `runContract(context) -> Promise<{checks?, findings?, coverage?, evidence?, networkErrors?, consoleErrors?}>`.
- Produces: `runCrosscutContracts({ contracts, context }) -> Promise<{checks, findings, coverage, evidence, networkErrors, consoleErrors}>`.
- Produces: export `./crosscut-runner` no pacote QA e export nomeado em `src/index.js`.

- [ ] **Step 1: Escrever testes falhando para agregação, not-applicable e harness error**

Criar testes que provem:

```js
assert.deepEqual(result.coverage, { discovered: 2, covered: 1, uncovered: 1, uncoveredCritical: 0 });
assert.equal(result.findings.find(x => x.code === 'qa-harness-error')?.severity, 'critical');
assert.equal(result.checks.find(x => x.name === 'optional-contract')?.status, 'not-applicable');
```

Um contract que lança exceção deve gerar check `failed` crítico + finding `qa-harness-error`. Contract `not-applicable` deve exigir `reason` e contar como discovered/uncovered, mas não como uncoveredCritical quando `critical:false`.

- [ ] **Step 2: Rodar o teste e confirmar RED**

Run: `node --test test/qa-crosscut-runner.test.js`
Expected: FAIL por módulo/função inexistente.

- [ ] **Step 3: Implementar `runCrosscutContracts({contracts, context})`**

Normalizar arrays ausentes para vazios, anexar `contractId` aos itens quando ausente, agregar coverage de forma determinística e converter exceções inesperadas em `qa-harness-error` sem abortar os demais contracts.

- [ ] **Step 4: Exportar o runner**

Adicionar `./crosscut-runner` em `qa/runtime/package.json` e export nomeado em `qa/runtime/src/index.js`.

- [ ] **Step 5: Rodar teste e checks de sintaxe**

Run: `node --test test/qa-crosscut-runner.test.js && node --check qa/runtime/src/crosscut-runner.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add qa/runtime/src/crosscut-runner.js qa/runtime/src/index.js qa/runtime/package.json test/qa-crosscut-runner.test.js
git commit -m "test: add crosscut contract runner"
```

---

### Task 2: Product gate normalization for expected failures and crosscut coverage

**Files:**
- Modify: `qa/runtime/src/product-report.js`
- Create: `test/qa-product-gate-crosscut.test.js`

**Interfaces:**
- Consumes: resultado agregado da Task 1.
- Produces: `evaluateProductGate(...)` ignorando network errors com `expected:true` na contagem de blockers e respeitando `coverage.uncoveredCritical`.
- Produces: `buildProductQaSummary(...)` preservando `coverage`, findings e contagens normalizadas.

- [ ] **Step 1: Escrever testes falhando para rede esperada e coverage crítico**

Asserções principais:

```js
assert.equal(expectedFailureSummary.gate.allowed, true);
assert.equal(expectedFailureSummary.networkErrorCount, 1);
assert.equal(unexpectedFailureSummary.gate.allowed, false);
assert.equal(coverageGapSummary.gate.blockers[0].type, 'critical-coverage-gap');
```

O primeiro caso usa `{type:'requestfailed', expected:true}`; o segundo usa o mesmo erro sem `expected`; o terceiro usa `{uncoveredCritical:1}`.

- [ ] **Step 2: Rodar e confirmar RED no caso `expected:true`**

Run: `node --test test/qa-product-gate-crosscut.test.js`
Expected: FAIL porque request failure esperado ainda é contado como blocker.

- [ ] **Step 3: Ajustar `evaluateProductGate`**

Filtrar somente erros inesperados para regras `maxHttp5xx`/`maxRequestFailures`; manter todos nos artifacts/counts para observabilidade.

- [ ] **Step 4: Rodar teste**

Run: `node --test test/qa-product-gate-crosscut.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add qa/runtime/src/product-report.js test/qa-product-gate-crosscut.test.js
git commit -m "test: harden product gate for crosscut evidence"
```

---

### Task 3: Data-driven optional module contract matrix

**Files:**
- Create: `qa/runtime/src/module-contracts.js`
- Create: `qa/crosscut/modules.json`
- Create: `test/module-crosscut-contracts.test.js`
- Modify: `qa/runtime/src/index.js`
- Modify: `qa/runtime/package.json`

**Interfaces:**
- Consumes: module definitions no formato `{id, dependsOn, defaultEnabled}` e probe map `{[moduleId]: {critical?, launcherSelector?, route?, supportsLiveSync?, protectedProbe?}}`.
- Produces: `buildModuleContractPlan({ modules, probes }) -> { contracts, coverage }`.
- Produces: `validateModuleProbeConfig({ modules, probes }) -> { ok, errors }`.
- `qa/crosscut/modules.json` declara probes somente para superfícies realmente conhecidas; ausência vira coverage explícita.

- [ ] **Step 1: Escrever teste falhando que usa os 9 módulos do registry real**

O teste carrega `js/core/modules/module-registry.js` e exige:

```js
assert.equal(plan.contracts.length, MODULES.length);
assert.equal(plan.contracts.find(x => x.moduleId === 'RESTAURANT').supportsLiveSync, true);
assert.equal(plan.coverage.discovered, MODULES.length);
```

Também validar que `WORKSHOP.dependsOn=['SERVICES']` gera check declarativo de dependência, e que módulo sem launcher/protected probe fica `not-applicable` nessa subcapacidade com `reason` explícito.

- [ ] **Step 2: Rodar e confirmar RED**

Run: `node --test test/module-crosscut-contracts.test.js`
Expected: FAIL por helper/config inexistentes.

- [ ] **Step 3: Implementar planner/validator sem duplicar o registry**

O helper recebe `modules` de fora; não hardcoda IDs do PDV. `qa/crosscut/modules.json` contém metadata de QA do PDV, começando por `RESTAURANT` com live sync e seletores existentes e registrando as demais capacidades conhecidas conforme código atual.

- [ ] **Step 4: Adicionar teste para configuração inválida**

Probe para ID inexistente deve produzir erro `unknown module probe: <ID>`; dependência declarada no registry, mas inexistente na lista, deve ser erro de validação.

- [ ] **Step 5: Rodar testes**

Run: `node --test test/module-crosscut-contracts.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add qa/runtime/src/module-contracts.js qa/crosscut/modules.json qa/runtime/src/index.js qa/runtime/package.json test/module-crosscut-contracts.test.js
git commit -m "test: generalize optional module QA contracts"
```

---

### Task 4: Structural UX findings in `ui-sweep`

**Files:**
- Modify: `qa/runtime/src/ui-sweep.js`
- Create: `test/ui-sweep-structural.test.js`

**Interfaces:**
- Consumes: DOM inventory já coletado por `runUiSweep`.
- Produces por página: `structuralFindings[]` com `{code,severity,selector,detail,rect?}`.
- Produces no resultado global: `findings[]` agregados.
- Códigos iniciais: `horizontal-overflow`, `interactive-offscreen`, `interactive-overlap`, `control-unlabelled`.

- [ ] **Step 1: Escrever harness DOM fake mínimo e testes falhando para overflow/offscreen/unlabelled**

Asserções:

```js
assert.ok(result.findings.some(x => x.code === 'horizontal-overflow'));
assert.ok(result.findings.some(x => x.code === 'interactive-offscreen'));
assert.ok(result.findings.some(x => x.code === 'control-unlabelled'));
```

- [ ] **Step 2: Escrever teste de overlap verdadeiro e de overlay/containment permitido**

Dois botões irmãos visíveis com interseção material devem gerar `interactive-overlap`. Filho contido no próprio botão, badge/ícone interno e elementos dentro de `[role="dialog"]` ativo não devem gerar finding de overlap entre si.

- [ ] **Step 3: Rodar e confirmar RED**

Run: `node --test test/ui-sweep-structural.test.js`
Expected: FAIL porque `findings`/códigos ainda não existem.

- [ ] **Step 4: Implementar coleta geométrica dentro do `page.evaluate`**

Usar `document.documentElement.scrollWidth > document.documentElement.clientWidth` para overflow e `getBoundingClientRect()` para controles interativos visíveis. Considerar somente elementos com dimensões positivas e estilo visível; overlap exige interseção material e elementos que não sejam ancestral/descendente.

- [ ] **Step 5: Integrar severidades iniciais**

`horizontal-overflow` e `interactive-overlap` => `high`; `interactive-offscreen` => `high`; `control-unlabelled` => `medium`. O product gate só trata `critical` como blocker automático nesta etapa; o crosscut contract poderá promover categorias configuradas em Task 5.

- [ ] **Step 6: Rodar testes e sintaxe**

Run: `node --test test/ui-sweep-structural.test.js && node --check qa/runtime/src/ui-sweep.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add qa/runtime/src/ui-sweep.js test/ui-sweep-structural.test.js
git commit -m "test: detect structural UX regressions"
```

---

### Task 5: Crosscut profile capability and renderer-health contract

**Files:**
- Create: `qa/runtime/src/contracts/renderer-health.js`
- Modify: `qa/runtime/src/profile-runner.js`
- Modify: `qa/runtime/src/profiles.js`
- Modify: `qa/artisys-qa.config.json`
- Create: `test/qa-crosscut-profile.test.js`

**Interfaces:**
- Consumes: `runCrosscutContracts` (Task 1), `runUiSweep` (Task 4), product gate inputs (Task 2).
- Produces profile fields: `includeCrosscut:boolean`, `crosscutCritical:boolean`.
- Produces `runRendererHealthContract({ sweepResult, policy })` convertendo console/page/network/structural evidence para checks/findings.
- `full` e `release` habilitam crosscut; `quick` mantém crosscut barato/desabilitado por default do manifesto desta entrega.

- [ ] **Step 1: Escrever teste falhando para resolução de perfis**

Exigir no manifesto do PDV:

```js
assert.equal(resolveQaProfile(manifest,'quick').includeCrosscut, false);
assert.equal(resolveQaProfile(manifest,'full').includeCrosscut, true);
assert.equal(resolveQaProfile(manifest,'release').includeCrosscut, true);
```

- [ ] **Step 2: Escrever teste do renderer-health contract**

Console error, page error, request failure inesperado e HTTP 5xx devem produzir check `failed`; request failure com `expected:true` permanece evidence sem falhar o check. Finding estrutural `high` configurado em `policy.blockSeverities=['high','critical']` deve virar finding crítico normalizado para o product gate.

- [ ] **Step 3: Rodar e confirmar RED**

Run: `node --test test/qa-crosscut-profile.test.js`
Expected: FAIL por capability/contract inexistentes.

- [ ] **Step 4: Implementar campos de perfil e renderer-health contract**

Defaults do runtime: `quick.includeCrosscut=false`, `full.includeCrosscut=false`, `release.includeCrosscut=false`; o manifesto do PDV opta explicitamente por `true` em `full`/`release` para evitar mudar consumidores externos do runtime.

- [ ] **Step 5: Integrar `profile-runner` sem duplicar execução de flows**

Após flows funcionais, quando `includeCrosscut`, executar contracts configurados/injetados e anexar checks normalizados aos `results`. Falha crítica participa do mesmo gate de release e seus artifacts entram no relatório.

- [ ] **Step 6: Rodar testes focados**

Run: `node --test test/qa-crosscut-profile.test.js test/qa-crosscut-runner.test.js test/qa-product-gate-crosscut.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add qa/runtime/src/contracts/renderer-health.js qa/runtime/src/profile-runner.js qa/runtime/src/profiles.js qa/artisys-qa.config.json test/qa-crosscut-profile.test.js
git commit -m "test: integrate crosscut checks with QA profiles"
```

---

### Task 6: `qa:crosscut` command/script and release CI gate

**Files:**
- Modify: `qa/runtime/src/cli.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `test/artisys-qa-integration.test.js`
- Create: `test/qa-crosscut-ci.test.js`

**Interfaces:**
- Produces CLI command: `crosscut --config <file> --environment <name> --viewport <name> --output <dir>`.
- Produces root script: `qa:crosscut`.
- CI executa `qa:crosscut` após `qa:release` no job `e2e` e preserva artifacts existentes.

- [ ] **Step 1: Escrever testes falhando para script/CLI/workflow**

Exigir:

```js
assert.match(pkg.scripts['qa:crosscut'], /artisys-qa\.mjs crosscut/);
assert.match(cliSource, /args\.command === 'crosscut'/);
assert.match(workflow, /npm run qa:crosscut/);
```

Também exigir que o command use `runQaProfile` ou entrypoint dedicado com somente crosscut, sem rodar novamente todos os flows funcionais.

- [ ] **Step 2: Rodar e confirmar RED**

Run: `node --test test/qa-crosscut-ci.test.js test/artisys-qa-integration.test.js`
Expected: FAIL pela ausência do comando/script.

- [ ] **Step 3: Implementar entrypoint crosscut isolado**

Adicionar função pública `runCrosscutProfile({manifest, rootDir, environment, viewport, outputRoot, ...})` no módulo da Task 1 ou em arquivo focado se necessário; CLI `crosscut` chama essa função. Não usar `runQaProfile(full/release)` para evitar duplicar flows.

- [ ] **Step 4: Adicionar root script**

`qa:crosscut`: `node qa/runtime/artisys-qa.mjs crosscut --config qa/artisys-qa.config.json --environment ci --viewport desktop --output qa-artifacts`.

- [ ] **Step 5: Integrar CI**

No job `e2e`, após `Run release E2E flows`, executar `xvfb-run -a npm run qa:crosscut`. Manter upload de `qa-artifacts`, `qa-report`, `qa-results` com `if: always()`.

- [ ] **Step 6: Rodar testes**

Run: `node --test test/qa-crosscut-ci.test.js test/artisys-qa-integration.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add qa/runtime/src/cli.mjs package.json .github/workflows/verify.yml test/artisys-qa-integration.test.js test/qa-crosscut-ci.test.js
git commit -m "ci: add crosscut QA gate"
```

---

### Task 7: End-to-end regression for external module state + crosscut product bundle

**Files:**
- Modify: `qa/flows/restaurant-module-sync-e2e.json`
- Modify: `qa/artisys-qa.config.json`
- Create: `test/qa-crosscut-product-bundle.test.js`
- Modify: `release/e2e-coverage.json`

**Interfaces:**
- Consumes: gate/runner/contracts das Tasks 1–6.
- Produces evidence de regression category `state-sync` e product bundle com coverage/findings/network/console agregados.

- [ ] **Step 1: Escrever teste de configuração falhando para regression metadata**

Exigir que `restaurant-module-sync-e2e` declare metadata/categoria `state-sync` e que `release/e2e-coverage.json` referencie `qa:crosscut` como evidence/gate transversal sem remover os gates existentes.

- [ ] **Step 2: Fortalecer o flow existente**

Após desativação externa e launcher oculto, tentar validar a rota/ação antiga pelo probe suportado e exigir que não ocorra fallback para Configurações. Após reativação, exigir launcher restaurado e navegação correta.

- [ ] **Step 3: Escrever teste do bundle agregado**

Montar resultado sintético com checks de módulo + renderer health + structural findings e confirmar que `buildProductQaSummary`/bundle registra `coverage`, `findingCount`, `networkErrorCount` e bloqueia quando há finding crítico.

- [ ] **Step 4: Rodar testes focados**

Run: `node --test test/qa-crosscut-product-bundle.test.js test/module-crosscut-contracts.test.js test/qa-crosscut-profile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add qa/flows/restaurant-module-sync-e2e.json qa/artisys-qa.config.json release/e2e-coverage.json test/qa-crosscut-product-bundle.test.js
git commit -m "test: close crosscut module regression loop"
```

---

### Task 8: Full verification and documentation sync

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify if required by docs gate: `release/release-checklist.md`

**Interfaces:**
- Documents: quando usar `qa:quick`, `qa:crosscut`, `qa:full`, `qa:release`; política de evidence e blockers.

- [ ] **Step 1: Documentar o novo gate e taxonomia inicial**

Registrar `state-sync`, `navigation`, `rerender`, `responsive-layout`, `authorization`, `idempotency`, `migration`, `http-classification`, `concurrency`, `recovery` como categorias de regressão, sem transformar documentação em duplicação do runtime.

- [ ] **Step 2: Rodar testes focados novos**

Run: `node --test test/qa-crosscut-runner.test.js test/qa-product-gate-crosscut.test.js test/module-crosscut-contracts.test.js test/ui-sweep-structural.test.js test/qa-crosscut-profile.test.js test/qa-crosscut-ci.test.js test/qa-crosscut-product-bundle.test.js`
Expected: PASS.

- [ ] **Step 3: Rodar gate de unidade/integração**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 4: Rodar validação do manifesto**

Run: `npm run qa:validate`
Expected: PASS.

- [ ] **Step 5: Rodar crosscut real**

Run: `xvfb-run -a npm run qa:crosscut`
Expected: PASS e artifacts estruturados gerados.

- [ ] **Step 6: Rodar E2E release**

Run: `xvfb-run -a npm run qa:release`
Expected: PASS.

- [ ] **Step 7: Rodar gate final de release**

Run: `npm run verify:release`
Expected: PASS.

- [ ] **Step 8: Commit de documentação/ajustes finais**

```bash
git add README.md CONTRIBUTING.md release/release-checklist.md
git commit -m "docs: document crosscut QA hardening"
```

## Deferred to follow-up plans

Esta fundação não implementa ainda os subsistemas independentes abaixo; ela cria os contracts/gate que eles usarão:

1. deterministic pairwise state matrix + fault injection/recovery;
2. branch coverage por risco;
3. packaged Windows functional smoke + mutation testing periódico.

Cada um terá plano separado e poderá ser aprovado/revertido independentemente sem desfazer `qa:crosscut`.
