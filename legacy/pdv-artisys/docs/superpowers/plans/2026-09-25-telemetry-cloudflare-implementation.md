# ArtiSys Telemetry + Cloudflare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar telemetria opt-in, privacy-first e fail-open ao ArtiSys, com identidade pseudônima, fila SQLite local no servidor autoritativo, eventos semânticos, diagnóstico/fingerprints e coletor serverless em Cloudflare Workers + Analytics Engine + D1, sem tornar a nuvem requisito operacional do PDV.

**Architecture:** O servidor ArtiSys mantém a fila e a identidade de telemetria junto do runtime autoritativo; terminais LAN enviam apenas eventos UI allowlisted pela API autenticada, portanto não abrem SQLite local nem recebem credenciais Cloudflare. Eventos de negócio vêm do EventBus durável e de classificadores HTTP estreitos. O Worker revalida/sanitiza, envia o stream de alta cardinalidade ao Analytics Engine e usa D1 somente para cadastro de instalações, credenciais hashadas, fingerprints e receipts idempotentes de baixo volume.

**Tech Stack:** Node.js >=22, CommonJS no core/desktop, `node:test`, `node:crypto`, SQLite (`node:sqlite` via abstração existente), Electron 39 `safeStorage`, Cloudflare Workers, D1, Workers Analytics Engine, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-25-telemetry-cloudflare-design.md`

## Global Constraints

- Telemetria fica `false` por padrão e upgrades não podem ativá-la silenciosamente.
- Venda, devolução, impressão, fiscal, estoque, restaurante, login e startup funcionam quando internet/Worker/D1/Analytics Engine estiverem indisponíveis.
- Core obrigatório permanece local/self-hosted/open; Cloudflare é destino opcional/configurável, nunca dependência silenciosa.
- Endpoint padrão em source/dev é vazio; build oficial pode injetar `PDV_TELEMETRY_ENDPOINT` explicitamente.
- Terminais LAN continuam sem SQLite de negócio local; fila de telemetria fica no servidor autoritativo.
- Renderer não recebe SQLite, filesystem, credencial de ingestão nem `safeStorage`.
- Credencial de telemetria é separada de login/LAN/fiscal e fica no host servidor com `safeStorage` quando Electron estiver hospedando o runtime.
- Nenhum evento contém nome de cliente/operador, CPF/CNPJ, telefone, e-mail, endereço, observação livre, XML/DANFE, PAN/CVV, senha, token, Authorization, certificado, CSC ou segredo equivalente.
- `installation_id` e `terminal_id` de telemetria são UUIDs aleatórios persistidos localmente e não são derivados de MAC, hostname, usuário do Windows, documento, serial de hardware ou ID comercial transmitido.
- Fila local: máximo padrão 5.000; batch padrão 50; erro/diagnóstico tem prioridade de retenção sobre fluxo.
- Delivery é at-least-once; somente mutações D1 de erro/controle usam receipt dedupe por `event_id`.
- D1 não armazena o stream geral; Analytics Engine recebe eventos de alta cardinalidade.
- Testes normais/CI não dependem de conta Cloudflare real.

## Review Focus

1. **PII/segredo em chave ou string aparentemente válida:** cliente e Worker rejeitam/sanitizam sem persistir o valor proibido.
2. **Worker lento/fora do ar durante venda:** negócio conclui normalmente; somente fila/retry muda.
3. **401/403 por credencial revogada:** envio pausa; registro ocorre somente em ciclo background sem loop agressivo.
4. **SQLite cheio/erro ao gravar telemetria:** `record()` nunca falha o fluxo chamador.
5. **Mesmo erro entregue duas vezes:** Analytics pode receber duplicata at-least-once, mas D1 não duplica contador/fingerprint pelo mesmo `event_id`.

---

## Mapa de arquivos

### Criar

- `js/core/telemetry/telemetry-events.js` — catálogo/schema allowlisted.
- `js/core/telemetry/telemetry-sanitizer.js` — validação de campos/valores.
- `js/core/telemetry/telemetry-fingerprint.js` — assinatura técnica estável.
- `js/core/telemetry/telemetry-identity.js` — `installation_id` + mapa local `terminalKey -> telemetry_terminal_id` aleatório.
- `js/core/telemetry/telemetry-queue.js` — fila SQLite limitada/retry.
- `js/core/telemetry/telemetry-service.js` — `record/flush/status/setEnabled/close`.
- `js/core/telemetry/telemetry-effects.js` — adaptação EventBus -> eventos de telemetria.
- `desktop/telemetry-credentials.cjs` — credencial Cloudflare protegida no host Electron servidor.
- `desktop/telemetry-bridge.cjs` — sender HTTPS, bootstrap e background flush.
- `test/telemetry-schema.test.js`, `test/telemetry-queue.test.js`, `test/telemetry-service.test.js`, `test/telemetry-effects.test.js`, `test/telemetry-desktop.test.js`, `test/telemetry-settings-ui.test.js`.
- `cloudflare/telemetry/package.json`, `wrangler.jsonc`, `src/schema.js`, `src/auth.js`, `src/storage.js`, `src/index.js`, `migrations/0001_init.sql`, `test/worker.test.js`, `README.md`.
- `scripts/setup-cloudflare-telemetry.mjs`, `test/cloudflare-telemetry-setup.test.js`.
- `docs/operations/telemetry.md`.

### Modificar

- `js/core/pdv-runtime.js` — compor identidade/fila/service e registrar effects.
- `server/router.js` — UI-event endpoint autenticado e classificação estreita de falhas técnicas.
- `server/start.js` — endpoint opcional e host background quando executado sem Electron.
- `desktop/main.cjs` — credential store/sender/flush quando hospeda runtime.
- `desktop/preload.cjs` — sem credencial; somente superfícies já necessárias.
- `desktop/renderer/api-client.js` — `recordTelemetryUi()` e settings.
- `desktop/renderer/admin-ops.js` — Privacidade e Diagnóstico.
- `desktop/renderer/app.js` — `screen_opened`.
- `package.json`, `README.md`, `release/release-notes.md`.

---

### Task 1: Schema allowlisted, sanitizer e fingerprint

**Files:** Create `js/core/telemetry/telemetry-events.js`, `telemetry-sanitizer.js`, `telemetry-fingerprint.js`; Test `test/telemetry-schema.test.js`; Modify `package.json`.

**Interfaces:**
- `validateTelemetryEvent(eventName,payload) -> {dimensions,measurements}`.
- `sanitizeTelemetryEnvelope(envelope) -> sanitizedEnvelope`.
- `normalizeErrorSignature({errorClass,subsystem,operation,stack}) -> string`.
- `fingerprintError(input) -> "ERR-<hex>"`.
- Schemas iniciais: `app_started`, `app_closed`, `screen_opened`, `sale_started`, `sale_completed`, `sale_failed`, `return_started`, `return_completed`, `return_failed`, `printer_failed`, `fiscal_failed`, `database_failed`, `network_failed`, `operation_failed`.

- [ ] **Step 1: Write RED tests**: evento/campo desconhecido rejeitado; nomes `token|authorization|password|cpf|cnpj|email|phone|address|xml|danfe|card|cvv|observation` rejeitados; strings bounded; fingerprint ignora UUID/path/IDs dinâmicos e muda por classe/subsystem/operation.
- [ ] **Step 2: Run RED:** `node --test test/telemetry-schema.test.js` -> FAIL por módulos ausentes.
- [ ] **Step 3: Implement `EVENT_SCHEMAS`** sem payload recursivo nem spreads arbitrários.
- [ ] **Step 4: Implement sanitizer/fingerprint** com `node:crypto.createHash('sha256')`; stack é normalizada antes de qualquer persistência.
- [ ] **Step 5: Verify:** `node --test test/telemetry-schema.test.js` + `node --check` dos três módulos -> PASS.
- [ ] **Step 6: Commit:** `feat(telemetry): add privacy-safe event schemas`.

---

### Task 2: Identidade pseudônima, fila SQLite e serviço fail-open

**Files:** Create `js/core/telemetry/telemetry-identity.js`, `telemetry-queue.js`, `telemetry-service.js`; Test `test/telemetry-queue.test.js`, `test/telemetry-service.test.js`; Modify `js/core/pdv-runtime.js`.

**Interfaces:**
- `createTelemetryIdentity({db,randomUUID})` -> `installationId()`, `terminalId(terminalKey)`; tabela guarda somente UUIDs e chave local do terminal, nunca envia `terminalKey`.
- `createTelemetryQueue({db,now,maxPending=5000})` -> `enqueue`, `listReady`, `ack`, `discard`, `reschedule`, `count`, `prune`.
- `createTelemetryService({db,settings,logger,identity,now,idFactory,httpSender,appVersion,releaseId,schemaVersionResolver})`.
- Service: `record(eventName,payload,{terminalKey})`, `flush()`, `status()`, `setEnabled(enabled,actor)`, `close()`.
- `record()` nunca lança. `flush()` -> `{attempted,sent,retryable,discarded,paused}`.

- [ ] **Step 1: Write identity/queue RED tests**: installation UUID sobrevive restart; mesmo terminalKey mantém UUID aleatório; terminal diferente recebe UUID diferente; fila sobrevive restart; hard cap 5.000; erros sobrevivem trimming antes de flow.
- [ ] **Step 2: Run RED:** `node --test test/telemetry-queue.test.js`.
- [ ] **Step 3: Implement identity + queue** com tabelas/indexes idempotentes; nenhum valor de identity local entra no envelope além dos UUIDs pseudônimos.
- [ ] **Step 4: Write service RED tests**: disabled default; `record()` em erro SQLite não lança; batch 50; `400/413/422` discard; `401/403` pause; `429/5xx` retry/backoff; endpoint vazio não envia.
- [ ] **Step 5: Add disable-after-queue test**: evento já enfileirado não é enviado enquanto `telemetry.enabled=false`; reenable permite flush posterior. Service consulta setting tanto em `record()` quanto em `flush()`.
- [ ] **Step 6: Implement service sem timer interno**; background pertence ao host.
- [ ] **Step 7: Compose `runtime.telemetry`** em `createPdvRuntime()` com settings defaults `false,false,'',50`; runtime sem sender funciona normalmente.
- [ ] **Step 8: Verify:** `node --test test/telemetry-queue.test.js test/telemetry-service.test.js test/pdv-runtime.integration.test.js` -> PASS.
- [ ] **Step 9: Commit:** `feat(telemetry): add pseudonymous durable telemetry service`.

---

### Task 3: Instrumentação semântica de domínio e falhas técnicas

**Files:** Create `js/core/telemetry/telemetry-effects.js`; Test `test/telemetry-effects.test.js`; Modify `js/core/pdv-runtime.js`, `server/router.js`.

**Interfaces:**
- `registerTelemetryEffects({bus,telemetry}) -> unsubscribe[]`.
- EventBus maps: `SALE_OPENED -> sale_started`, `SALE_COMPLETED -> sale_completed`, `RETURN_COMPLETED -> return_completed`, `RECEIPT_FAILED -> printer_failed`, `FISCAL_FAILED|FISCAL_REJECTED|FISCAL_UNKNOWN -> fiscal_failed`.
- Router failure classifier: `classifyTelemetryHttpFailure({method,pathname,status}) -> null|{eventName,dimensions}`; nunca inclui URL query/body/error message.
- `sale_failed`/`return_failed` são emitidos somente para falhas técnicas `5xx` em mutation routes correspondentes; validações `4xx` não são bugs.
- `operation_failed` cobre `5xx` técnicos de rotas allowlisted não específicas; `database_failed` somente quando erro técnico classificado como SQLite/storage sem mensagem bruta.

- [ ] **Step 1: Write RED effect tests**: payload de domínio não é copiado; `actor.userId`, cliente/produto/observações/IDs comerciais não são enviados.
- [ ] **Step 2: Write fail-open test**: stub de `telemetry.record()` lança e `runtime.dispatchPending()` continua sem marcar o outbox de negócio como falho por observabilidade; adapter deve capturar internamente.
- [ ] **Step 3: Write router classifier tests**: 500 em `/api/v1/sales/.../complete` -> `sale_failed`; 500 em `/api/v1/returns...` -> `return_failed`; 400/401/403/404 -> null; payload/URL query não aparece.
- [ ] **Step 4: Run RED:** `node --test test/telemetry-effects.test.js`.
- [ ] **Step 5: Implement adapters/classifier** com campos técnicos allowlisted apenas.
- [ ] **Step 6: Register effects after telemetry creation**; classificador é chamado no catch global sem alterar status HTTP existente.
- [ ] **Step 7: Verify:** `node --test test/telemetry-effects.test.js test/pdv-runtime.integration.test.js` -> PASS.
- [ ] **Step 8: Commit:** `feat(telemetry): observe domain and technical failures`.

---

### Task 4: Credencial segura, bootstrap e background sender no host

**Files:** Create `desktop/telemetry-credentials.cjs`, `desktop/telemetry-bridge.cjs`; Test `test/telemetry-desktop.test.js`; Modify `desktop/main.cjs`, `server/start.js`, `package.json`.

**Interfaces:**
- `createTelemetryCredentialStore({app,safeStorage})` -> `save/load/remove/status`, arquivo `telemetry-credential.bin`.
- `createTelemetryHttpSender({endpoint,credentialStore,fetchImpl,registerInstallation,timeoutMs}) -> sendBatch(batch)`.
- `POST /v1/installations/register` só após opt-in e ausência de credential.
- Registro envia somente random `installation_id`, app/release/schema/protocol version.

- [ ] **Step 1: Write RED desktop tests**: credential criptografada; `safeStorage` indisponível não cai startup; endpoint vazio = zero fetch; registration failure = estado offline.
- [ ] **Step 2: Add lifecycle RED tests**: após runtime pronto, host chama `record('app_started',...)`; shutdown chama `app_closed` best-effort antes de `close()`, mas timeout de telemetria não segura encerramento.
- [ ] **Step 3: Run RED:** `node --test test/telemetry-desktop.test.js`.
- [ ] **Step 4: Implement store/sender** com `AbortController` e timeout curto; Bearer só no processo host.
- [ ] **Step 5: Integrate Electron server-terminal host** com timer `flush()` desacoplado/`unref()`; terminal remoto não possui credential Cloudflare.
- [ ] **Step 6: Integrate `server/start.js`** para modo headless: endpoint opcional e sender sem Electron deve receber credential por secret/env explícito somente quando operador configurar esse modo; ausência de secret mantém coleta local sem envio e nunca bloqueia server.
- [ ] **Step 7: Verify syntax/tests**.
- [ ] **Step 8: Commit:** `feat(telemetry): add protected background transport`.

---

### Task 5: Opt-in, UI events e terminais LAN

**Files:** Modify `server/router.js`, `desktop/renderer/api-client.js`, `desktop/renderer/admin-ops.js`, `desktop/renderer/app.js`; Test `test/telemetry-settings-ui.test.js`, `test/e22-e25-api.test.js`.

**Interfaces:**
- Endpoint autenticado `POST /api/v1/system/telemetry/events` aceita somente UI event names `screen_opened` e `return_started` no primeiro release; body é revalidado pelo schema core.
- Router usa `session.terminalId || 'server-terminal'` apenas como chave local para `identity.terminalId()`, nunca envia esse ID real.
- `ApiClient.recordTelemetryUi(eventName,payload)` usa API existente/session; remote terminal funciona sem SQLite/Cloudflare credential local.
- UI **Configurações > Privacidade e Diagnóstico** persiste `telemetry.enabled` e `telemetry.diagnostics` via SettingsService existente.

- [ ] **Step 1: Write API RED tests**: endpoint exige sessão; evento fora da allowlist retorna 422; `screen_opened` válido retorna 202/204; real terminal ID não aparece na fila/envelope.
- [ ] **Step 2: Write UI RED tests**: toggle default off; texto explicita dados nunca enviados; credential não aparece; `screen_opened` usa só nome de rota normalizado sem busca/ID.
- [ ] **Step 3: Write return flow test**: entrada no fluxo de devolução emite `return_started`; falha técnica do backend já vira `return_failed` pela Task 3.
- [ ] **Step 4: Run RED**.
- [ ] **Step 5: Implement endpoint + ApiClient/UI** reutilizando RBAC/settings existentes; não criar endpoint de configuração paralelo.
- [ ] **Step 6: Emit `screen_opened` nos limites de navegação**; erro de telemetria UI é ignorado e não gera toast de operação.
- [ ] **Step 7: Verify:** `node --test test/telemetry-settings-ui.test.js test/e22-e25-api.test.js` + renderer regressions -> PASS.
- [ ] **Step 8: Commit:** `feat(telemetry): add privacy controls and LAN-safe UI events`.

---

### Task 6: Worker Cloudflare, D1 e Analytics Engine

**Files:** Create `cloudflare/telemetry/package.json`, `wrangler.jsonc`, `src/schema.js`, `src/auth.js`, `src/storage.js`, `src/index.js`, `migrations/0001_init.sql`, `test/worker.test.js`.

**Interfaces:**
- `GET /health -> 200 {ok:true,schemaVersion:1}`.
- `POST /v1/installations/register` -> `{installation_id,credential}`; D1 guarda somente hash.
- `POST /v1/events` requer Bearer; máximo 50 eventos/batch e body bounded.
- Bindings: `DB` D1 e `ANALYTICS` Analytics Engine.
- Export testável: `validateRegistration`, `validateBatch`, `hashCredential`, `handleRequest`.

- [ ] **Step 1: Write RED Worker tests**: health; content-type/tamanho/schema; auth; sanitizer server-side; valid event; erro interno => 500, nunca 400/401 mascarado.
- [ ] **Step 2: Duplicate test**: mesmo `event_id` de erro duas vezes muta fingerprint D1 uma vez; flow duplicado não cria receipt D1.
- [ ] **Step 3: Affected-installation test**: primeira `(fingerprint,installation)` incrementa; repetição não incrementa.
- [ ] **Step 4: Run RED:** `npm --prefix cloudflare/telemetry test`.
- [ ] **Step 5: Implement migration** `installations`, `error_fingerprints`, `error_fingerprint_installations`, `event_receipts` + indexes.
- [ ] **Step 6: Implement auth/registration** com credential randômica >=32 bytes; hash persistido; plaintext apenas na resposta inicial.
- [ ] **Step 7: Implement ingestion**: revalidar allowlist, `ANALYTICS.writeDataPoint`, atualizar `last_seen`; D1 agregado somente para erro/controle.
- [ ] **Step 8: Implement maintenance** purge de `event_receipts` após 30 dias; documentar retenção e não armazenar IP/raw rejected body.
- [ ] **Step 9: Verify:** Worker tests + `wrangler deploy --dry-run` quando disponível sem credencial real.
- [ ] **Step 10: Commit:** `feat(telemetry): add Cloudflare ingestion worker`.

---

### Task 7: Provisionamento automático pelo terminal

**Files:** Create `scripts/setup-cloudflare-telemetry.mjs`, `test/cloudflare-telemetry-setup.test.js`, `cloudflare/telemetry/README.md`; Modify root `package.json`, `cloudflare/telemetry/wrangler.jsonc`.

**Interfaces:**
- Root command: `npm run telemetry:cloudflare:setup`.
- Fluxo idempotente: `wrangler whoami` -> localizar/criar D1 -> atualizar/verificar binding -> migrations remote -> verificar Analytics binding -> deploy -> `/health` -> imprimir endpoint/config.

- [ ] **Step 1: Write RED setup tests** com executor fake: primeira execução cria; rerun reutiliza; recurso ambíguo falha explicitamente; health fail => exit !=0.
- [ ] **Step 2: Run RED:** `node --test test/cloudflare-telemetry-setup.test.js`.
- [ ] **Step 3: Implement command runner injetável** para testes sem Cloudflare.
- [ ] **Step 4: Implement D1 discovery/create e patch seguro de `wrangler.jsonc`** preservando outras chaves.
- [ ] **Step 5: Apply `wrangler d1 migrations apply ... --remote`, deploy e health check**.
- [ ] **Step 6: Final output obrigatório:** Worker URL, D1 name/id, Analytics binding e instrução `PDV_TELEMETRY_ENDPOINT=<url>`.
- [ ] **Step 7: Verify idempotency + syntax**.
- [ ] **Step 8: Commit:** `feat(telemetry): automate Cloudflare provisioning`.

---

### Task 8: Docs, lint e gates finais

**Files:** Create `docs/operations/telemetry.md`; Modify `README.md`, `release/release-notes.md`, `package.json`.

**Interfaces:**
- Root `test:telemetry:cloudflare` roda suite Worker local.
- `lint:core` inclui `js/core/telemetry/*`; `lint:desktop` inclui telemetry bridge/credential; setup script recebe `node --check`.
- Docs cobrem opt-in, dados coletados/não coletados, fila offline, desativação, retenção, Cloudflare opcional, custos/quota sujeitos ao plano vigente e comando único de setup.

- [ ] **Step 1: Add scripts/lints** e manter `npm test` cobrindo todos `test/*.test.js`.
- [ ] **Step 2: Write docs/release note** sem afirmar quota/preço permanente; orientar verificar Cloudflare antes de escala.
- [ ] **Step 3: Focused verify:**

```bash
node --test test/telemetry-schema.test.js test/telemetry-queue.test.js test/telemetry-service.test.js test/telemetry-effects.test.js test/telemetry-desktop.test.js test/telemetry-settings-ui.test.js test/cloudflare-telemetry-setup.test.js
npm --prefix cloudflare/telemetry test
```

- [ ] **Step 4: Full verify:** `npm run verify && npm run test:release`.
- [ ] **Step 5: Release verify:** `npm run verify:release`.
- [ ] **Step 6: Security/privacy review**: nenhum código novo faz spread de `event.payload`, request body ou `process.env` para telemetria; fixtures não contêm segredo real.
- [ ] **Step 7: Whole-branch review** com foco em fail-open, PII, auth bootstrap, crescimento D1, timers e regressões EventBus/LAN.
- [ ] **Step 8: Commit:** `docs(telemetry): document privacy and operations`.

---

## Matriz de emissão inicial

| Evento | Origem inicial |
|---|---|
| `app_started` / `app_closed` | lifecycle do host do runtime (Task 4) |
| `screen_opened` | renderer -> API autenticada (Task 5) |
| `sale_started` / `sale_completed` | EventBus (Task 3) |
| `sale_failed` | classificador de `5xx` em mutations de venda (Task 3) |
| `return_started` | entrada explícita no fluxo UI (Task 5) |
| `return_completed` | EventBus (Task 3) |
| `return_failed` | classificador de `5xx` em devolução (Task 3) |
| `printer_failed` | `RECEIPT_FAILED` (Task 3) |
| `fiscal_failed` | eventos fiscal failed/rejected/unknown (Task 3) |
| `database_failed` | classificador técnico allowlisted de storage/SQLite `5xx` (Task 3) |
| `operation_failed` | outros `5xx` de rotas explicitamente allowlisted (Task 3) |
| `network_failed` | schema entregue na v1; emissão fica limitada a falhas de rede de operações ArtiSys que possam ser observadas com segurança pelo host; falha da própria telemetria não gera `network_failed` para evitar recursão |

A matriz evita eventos mortos acidentais e também evita inventar captura insegura só para preencher métricas.

## Ordem de entrega

1. Tasks 1–2: telemetria local testável sem rede.
2. Task 3: fluxos reais e erros técnicos, ainda sem Cloudflare.
3. Tasks 4–5: opt-in, transporte seguro e suporte a terminais LAN.
4. Task 6: coletor serverless isoladamente testável.
5. Task 7: provisionamento Worker/D1/migrations/deploy pelo terminal.
6. Task 8: documentação e gates.

Nenhuma task antes da 6 requer conta Cloudflare para passar testes, e nenhuma instalação do ArtiSys requer Cloudflare para vender ou operar.