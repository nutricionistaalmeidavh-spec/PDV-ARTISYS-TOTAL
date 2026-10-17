# Hardening de módulos e release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os bugs encontrados na auditoria da `main`: enforcement real do módulo Restaurante, sincronização entre terminais, classificação HTTP correta, instalação determinística e metadados de release sem versão obsoleta.

**Architecture:** O estado de módulo deve ser imposto no backend, não apenas no renderer. O renderer continua responsável por UX e passa a reconciliar periodicamente o estado do servidor. Erros HTTP ganham um classificador pequeno e compartilhado. A release passa a instalar dependências por lockfile e o checklist deixa de congelar uma versão que fica obsoleta a cada release automática.

**Tech Stack:** Node.js 22, Electron, SQLite, `node:test`, Playwright/ArtiSys QA, GitHub Actions.

**Spec:** `README.md`, `CONTRIBUTING.md`, `release/limitations.json` e comportamento documentado dos módulos opcionais.

## Global Constraints

- Operação obrigatória local-first/self-hosted; nenhuma dependência SaaS paga.
- Windows x64 permanece alvo comercial moderno.
- `SaleService` continua canônico para vendas.
- Mudanças observáveis devem atualizar documentação e gates na mesma entrega.
- Nenhuma mutação específica de módulo desativado pode ser aceita pelo backend.

## Review Focus

- Restaurante desativado via setting deve rejeitar mutações desktop e mobile.
- Mudança feita por outro cliente deve sumir com o launcher sem recarregar o app.
- Falha interna inesperada deve virar 500; erros de cliente conhecidos preservam 4xx.
- CI e release devem usar exatamente o grafo de dependências do lockfile.
- Checklist não pode voltar a ficar preso a uma versão já publicada.

---

### Task 1: Enforcement do Restaurante no backend

**Files:**
- Modify: `js/core/pdv-runtime.js`
- Modify: `js/domains/restaurant/restaurant-service.js`
- Test: `test/restaurant-module-disabled.test.js`

**Interfaces:**
- Consumes: `moduleService.requireEnabled('RESTAURANT')`.
- Produces: serviço de Restaurante que rejeita operações quando o módulo está desligado.

- [ ] Criar teste que monta runtime, desativa `RESTAURANT` e comprova que leitura/mutação específica falha com `MODULE_DISABLED`.
- [ ] Confirmar RED no CI da branch.
- [ ] Injetar `modules` em `createRestaurantService` e aplicar gate nas operações públicas.
- [ ] Confirmar GREEN no teste e na suíte.

### Task 2: Sincronização do launcher entre clientes

**Files:**
- Modify: `desktop/renderer/restaurant-module-gate.js`
- Modify: `qa/runtime/src/steps.js`
- Create: `qa/flows/restaurant-module-sync-e2e.json`
- Modify: `qa/artisys-qa.config.json`
- Test: `test/restaurant-module-sync.test.js`

**Interfaces:**
- Consumes: `ApiClient.modules()` e `window.artisysDesktop.apiRequest` no QA.
- Produces: reconciliação periódica/foco e E2E que altera o setting fora do wrapper local.

- [ ] Criar regressão comportamental que altera o setting por API direta e espera o launcher sumir.
- [ ] Confirmar RED.
- [ ] Adicionar reconciliação no gate por foco/visibilidade e intervalo local moderado.
- [ ] Adicionar ação QA mínima para chamada direta da API desktop e registrar o flow no perfil release.
- [ ] Confirmar GREEN no flow e na suíte.

### Task 3: Classificação HTTP 4xx/5xx

**Files:**
- Create: `server/http-error-status.js`
- Modify: `server/receipt-router.js`
- Modify: `server/return-authorization-router.js`
- Modify: `server/restaurant-router.js`
- Modify: `server/kit-combo-router.js`
- Modify: `server/product-variant-router.js`
- Modify: `server/fiscal-block6-router.js`
- Test: `test/http-error-status.test.js`

**Interfaces:**
- Produces: `statusForError(error, { uniqueConflict })` retornando status explícito, 409 para conflito conhecido e 500 para exceção inesperada.

- [ ] Escrever testes para 400 explícito, 409 de UNIQUE e 500 inesperado.
- [ ] Confirmar RED.
- [ ] Implementar helper e substituir fallbacks `|| 400` nos routers listados.
- [ ] Confirmar GREEN e ausência de regressão.

### Task 4: Instalação determinística

**Files:**
- Create: `package-lock.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `.github/workflows/release-windows.yml`
- Test: `test/release-dependency-lock.test.js`

**Interfaces:**
- Produces: dependências congeladas para Node 22 e uso de `npm ci` nos gates/release.

- [ ] Criar teste que exige lockfile raiz e `npm ci` nos workflows.
- [ ] Confirmar RED.
- [ ] Gerar lockfile com npm a partir do `package.json` atual, sem alterar dependências declaradas.
- [ ] Trocar instalação dos workflows por `npm ci --no-audit --no-fund`.
- [ ] Confirmar GREEN no CI.

### Task 5: Checklist e gate documental de release

**Files:**
- Modify: `release/release-checklist.md`
- Modify: `scripts/check-docs-consistency.js`
- Test: `test/docs-release-versioning.test.js`

**Interfaces:**
- Produces: checklist version-neutral, compatível com a versão automática resolvida pelo workflow.

- [ ] Criar teste que falha se `release/release-checklist.md` congelar um SemVer literal no título/artefato.
- [ ] Confirmar RED com o checklist 1.3.2 atual.
- [ ] Tornar o checklist explícito sobre `RELEASE_VERSION`/versão resolvida, sem afirmar 1.4.1 ou 1.4.12 como futura release.
- [ ] Integrar a invariância em `docs:check`.
- [ ] Confirmar GREEN.

## Rulings

- **Ruling:** não hardcodar `1.4.12` no checklist. O workflow atual resolve automaticamente o próximo patch; após merge, o próximo artefato será posterior a 1.4.12. Fixar 1.4.12 recriaria o mesmo bug imediatamente. O checklist passa a referenciar a versão resolvida pelo workflow.
- **Ruling:** o `package.json` permanece como versão-base/floor do resolvedor automático nesta entrega; alterar o modelo de versionamento é uma mudança independente e não é necessária para corrigir os cinco achados.
