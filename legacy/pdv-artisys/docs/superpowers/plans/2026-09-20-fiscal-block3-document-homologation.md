# Fiscal Block 3 Document + Homologation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o documento fiscal canônico a partir da venda concluída e integrar o sidecar ao protocolo real do ACBrMonitorPLUS para NFC-e em homologação, sem afirmar autorização externa enquanto P3-P5 não fornecerem certificado, CSC e tributação persistidos.

**Architecture:** `Sale` permanece canônica. `FiscalDocumentBuilder` transforma venda + contexto fiscal resolvido em um documento independente de provider. O sidecar converte esse documento para INI do ACBrMonitor, envia comandos via TCP loopback e normaliza resposta de autorização. O fluxo externo real fica opt-in e bloqueado por pré-condições explícitas.

**Tech Stack:** Node.js 22, Electron, SQLite existente, node:test, TCP `node:net`, ACBrMonitorPLUS local.

**Spec:** `docs/operations/fiscal.md`

## Global Constraints

- Fiscal nunca desfaz venda, estoque ou caixa.
- `total fiscal === total da venda` em centavos.
- Nenhum serviço pago é requisito do core.
- Sidecar e ACBrMonitor só podem ser acessados em loopback.
- NFC-e em homologação usa envio síncrono.
- Sem certificado/CSC/tributação do Bloco 2, o adapter real deve falhar fechado e nunca simular autorização.
- Focus permanece opcional e compatível.

## Review Focus

- Desconto global deve ser distribuído deterministicamente entre itens sem alterar o total canônico.
- Quantidades fracionárias devem preservar três casas e valores monetários devem permanecer em centavos até renderização.
- Resposta ACBr com `CStat` diferente de 100 não pode virar `ISSUED`.
- TCP deve usar terminador `CRLF . CRLF` e aceitar resposta fragmentada.
- O adapter real deve recusar endpoint ACBr fora de loopback e produção sem configuração explícita.

---

### Task 1: FiscalDocumentBuilder

**Files:**
- Create: `js/domains/fiscal/fiscal-document-builder.js`
- Test: `test/fiscal-document-builder.test.js`

**Interfaces:**
- Consumes: venda de `saleService.getSaleDetails(id)` e contexto fiscal resolvido pelo Bloco 2/futuro.
- Produces: `buildFiscalDocument({ sale, fiscalContext, documentType, environment, reference })`.

- [ ] Escrever testes RED para total canônico, rateio de desconto e validações.
- [ ] Implementar builder mínimo.
- [ ] Rodar testes focados e suíte completa.

### Task 2: ACBrMonitor protocol adapter

**Files:**
- Create: `server/fiscal-sidecar/acbr-monitor-protocol.js`
- Create: `server/fiscal-sidecar/acbr-monitor-adapter.js`
- Modify: `server/fiscal-sidecar/entry.js`
- Test: `test/acbr-monitor-adapter.test.js`

**Interfaces:**
- Consumes: FiscalDocument canônico.
- Produces: `issue/query/cancel/status` no contrato do sidecar.

- [ ] Escrever testes RED para INI, parser e TCP terminator.
- [ ] Implementar renderização INI e parser ACBr.
- [ ] Implementar transporte TCP loopback com timeout/limite.
- [ ] Tornar `acbr-monitor` um modo explícito do entrypoint.

### Task 3: Fluxo P6-P7 determinístico e E2E externo opt-in

**Files:**
- Modify: `js/domains/fiscal/fiscal-effects.js`
- Test: `test/fiscal-block3-flow.test.js`
- Create: `test/external/fiscal-acbr-homologation.external.test.js`
- Modify: `docs/operations/fiscal.md`

**Interfaces:**
- Consumes: builder, provider `acbr-local`, sidecar `acbr-monitor`.
- Produces: fluxo venda -> documento fiscal canônico -> sidecar -> resposta ACBr normalizada.

- [ ] Builder passa a ser usado no auto-issue quando `fiscalContext` estiver configurado.
- [ ] E2E determinístico prova chave, protocolo, XML e invariantes sem rede externa.
- [ ] E2E externo exige opt-in e credenciais/configuração do operador.
- [ ] `verify:release` e E2E de release precisam permanecer verdes.
