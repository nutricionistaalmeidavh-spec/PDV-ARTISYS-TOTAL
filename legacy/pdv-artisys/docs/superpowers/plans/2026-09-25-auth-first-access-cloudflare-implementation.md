# Auth First Access and Commercial Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar P0–P4 de identidade local, primeiro acesso e ativação comercial por e-mail no ArtiSys PDV sem prejudicar instalações existentes.

**Architecture:** A autenticação operacional permanece local e compatível com `username + senha`. A ativação comercial é uma camada pré-setup opcional, acionada apenas em instalações novas explicitamente configuradas, com Worker Cloudflare separado da telemetria e persistência local mínima da ativação.

**Tech Stack:** Node.js 22, Electron, SQLite, Cloudflare Workers, D1, Cloudflare Email Sending binding, node:test.

**Spec:** `docs/superpowers/specs/2026-09-25-auth-first-access-cloudflare-design.md`

## Global Constraints

- Instalações existentes com usuários não podem ser forçadas a ativação comercial.
- `username + senha` continua válido para todos os usuários existentes.
- `email` é opcional no core local.
- Cloudflare não participa de login operacional e sua indisponibilidade não bloqueia PDV já configurado.
- O Worker de conta é separado de `cloudflare/telemetry`.
- Nenhum hash/salt de senha local é enviado ao serviço remoto.
- Sem nova dependência paga no core; Cloudflare é infraestrutura comercial explicitamente configurada.

## Review Focus

- Banco legado já configurado deve migrar e autenticar sem e-mail.
- `PDV_REQUIRE_COMMERCIAL_ACTIVATION=true` nunca deve afetar banco já configurado.
- Falha/rede no endpoint remoto não deve afetar login local após setup.
- Código de ativação expirado/reutilizado deve falhar sem vazar licença.
- E-mail deve ser normalizado e único somente quando presente.

---

### Task 1: Migration de identidade e ativação local

**Files:**
- Modify: `js/core/database/release-migrations.js`
- Test: `test/database.test.js`

**Interfaces:**
- Produces: schema version 6 com colunas opcionais de e-mail em `users` e tabela `installation_activation`.

- [ ] Escrever teste de upgrade de banco legado com usuário existente, garantindo dados preservados e novas colunas/tabela.
- [ ] Rodar teste e confirmar falha antes da migration.
- [ ] Implementar migration 6 idempotente sem reescrever migrations anteriores.
- [ ] Rodar testes de banco.
- [ ] Commitar.

### Task 2: Catálogo de usuários compatível com e-mail opcional

**Files:**
- Modify: `js/domains/catalog/catalog-service.js`
- Test: `test/catalog-service.test.js`

**Interfaces:**
- Produces: `normalizeEmail(value)`, `publicUser` com `email`, `createUser/upsertUser` aceitando `email` opcional.

- [ ] Testar usuário legado sem e-mail, normalização e unicidade de e-mail.
- [ ] Confirmar falha.
- [ ] Implementar alteração mínima preservando `verifyUserPassword(username,password)`.
- [ ] Rodar testes de catálogo.
- [ ] Commitar.

### Task 3: Serviço local de ativação comercial

**Files:**
- Create: `js/core/account/account-service.js`
- Modify: `js/core/pdv-runtime.js`
- Test: `test/account-service.test.js`

**Interfaces:**
- Produces: `createAccountService({db,installationId,endpoint,requireCommercialActivation,fetchImpl,now})` com `status()`, `requestActivation(email)`, `verifyActivation({email,code})`, `activation()`.

- [ ] Testar defaults locais, bypass de instalação existente, persistência de ativação e falha remota.
- [ ] Confirmar falha.
- [ ] Implementar cliente remoto e persistência local mínima.
- [ ] Expor no runtime.
- [ ] Rodar testes.
- [ ] Commitar.

### Task 4: Contratos HTTP de setup/ativação

**Files:**
- Modify: `server/router.js`
- Modify: `server/local-server.js`
- Test: `test/ui-api-routes.test.js`

**Interfaces:**
- Produces: campos aditivos em `GET /api/v1/setup/status`; novos `POST /api/v1/setup/activation/request` e `/verify`; setup admin respeita ativação apenas para instalação nova configurada.

- [ ] Escrever testes de compatibilidade e ativação.
- [ ] Confirmar falha.
- [ ] Implementar endpoints pré-auth e proteção pós-setup.
- [ ] Rodar testes API.
- [ ] Commitar.

### Task 5: Configuração desktop e proxy seguro

**Files:**
- Modify: `desktop/bootstrap-config.cjs`
- Modify: `desktop/main.cjs`
- Modify: `desktop/renderer/api-client.js`
- Test: testes existentes de bootstrap/desktop relevantes.

**Interfaces:**
- Consumes: endpoints locais de Task 4.
- Produces: `PDV_ACCOUNT_ENDPOINT`, `PDV_REQUIRE_COMMERCIAL_ACTIVATION`; métodos `requestActivation`, `verifyActivation` no ApiClient.

- [ ] Testar defaults desabilitados e parsing explícito.
- [ ] Implementar configuração sem persistir secrets.
- [ ] Permitir install-token nos endpoints de ativação somente no servidor principal.
- [ ] Rodar lint/testes desktop.
- [ ] Commitar.

### Task 6: Primeiro acesso e login automático

**Files:**
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/styles.css` se necessário
- Modify: flows QA que codificam o login duplicado.

**Interfaces:**
- Consumes: `setupStatus`, `setupAdmin`, `requestActivation`, `verifyActivation`, `login`.
- Produces: fluxo local novo e fluxo comercial em duas etapas.

- [ ] Testar/ajustar flow QA para setup -> login automático.
- [ ] Implementar confirmação de senha, mostrar/ocultar e e-mail opcional no modo local.
- [ ] Implementar ativação comercial antes do setup quando requerida.
- [ ] Garantir que instalação existente continue em `showLogin()`.
- [ ] Rodar lint desktop/QA aplicável.
- [ ] Commitar.

### Task 7: Worker Cloudflare account

**Files:**
- Create: `cloudflare/account/package.json`
- Create: `cloudflare/account/wrangler.jsonc`
- Create: `cloudflare/account/migrations/0001_init.sql`
- Create: `cloudflare/account/src/index.js`
- Create: `cloudflare/account/src/auth.js`
- Create: `cloudflare/account/src/storage.js`
- Create: `cloudflare/account/src/email.js`
- Create: `cloudflare/account/test/account-worker.test.js`

**Interfaces:**
- Produces: `GET /health`, `POST /v1/activation/request`, `POST /v1/activation/verify`, `GET /v1/license/status`.

- [ ] Escrever testes do Worker com D1/email fakes.
- [ ] Implementar schema D1 e tokens hashados single-use com expiração.
- [ ] Implementar envio via `env.EMAIL.send()` quando binding existir e fake/in-memory nos testes.
- [ ] Rodar testes do Worker.
- [ ] Commitar.

### Task 8: Scripts, gates e documentação operacional

**Files:**
- Modify: `package.json`
- Create: `docs/operations/account-activation.md`
- Modify: `README.md` apenas onde necessário.

**Interfaces:**
- Produces: `test:account:cloudflare` e inclusão no `verify`.

- [ ] Adicionar scripts/gates.
- [ ] Documentar defaults, configuração Cloudflare, rollout e rollback.
- [ ] Rodar `npm test`, Worker tests, lints e `npm run verify` via CI.
- [ ] Commitar.

### Task 9: Verificação de compatibilidade e PR

**Files:**
- Test: suíte completa e CI da branch.

- [ ] Confirmar instalação legada: migration -> login por username -> operação sem Cloudflare.
- [ ] Confirmar instalação nova local: setup -> login automático.
- [ ] Confirmar instalação nova comercial: ativação -> setup -> login automático.
- [ ] Confirmar indisponibilidade Cloudflare não afeta instalação já configurada.
- [ ] Abrir PR com checklist e riscos de rollout.
