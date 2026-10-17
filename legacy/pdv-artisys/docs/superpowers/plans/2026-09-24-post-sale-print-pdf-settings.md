# Pós-venda, Impressão, PDF e Configuração de Impressora — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Após uma venda concluída, exibir `Imprimir` e `Salvar PDF` lado a lado, permitir PDF nativo sem impressora virtual e tornar impressora/papel/largura configuráveis e persistentes, com E2E real do arquivo PDF e sem acoplar sucesso da venda ao hardware.

**Architecture:** O servidor continua canônico para venda e snapshot do comprovante. Uma nova projeção de comprovante reutiliza `receipt-renderer`/branding e alimenta tanto `print_jobs` quanto o bridge Electron. O processo principal Electron recebe apenas `saleId + sessionToken`, busca o comprovante autenticado na API local/LAN, imprime localmente ou gera PDF via `printToPDF()`/`showSaveDialog()`. Preferências de impressão ficam em `app_settings` com fallback para variáveis legadas e são resolvidas no terminal no momento da tentativa.

**Tech Stack:** Node.js 22, Electron 39, SQLite, `node:test`, IPC com `contextBridge`, ArtiSys QA/Playwright, APIs locais `/api/v1`.

**Spec:** `docs/superpowers/specs/2026-09-24-post-sale-print-pdf-settings-design.md`

## Global Constraints

- Core obrigatório sem SaaS, sem internet e sem serviço pago; nenhuma impressora PDF virtual é requisito.
- `Salvar PDF` deve funcionar mesmo quando não existe impressora física instalada.
- A venda concluída nunca é revertida por falha/cancelamento de impressão ou PDF.
- Renderer não recebe `fs`, caminho arbitrário de escrita, `BrowserWindow`, `dialog` ou acesso genérico ao SO.
- Somente venda `COMPLETED` pode ser usada no fluxo de pós-venda.
- `Imprimir` e `Salvar PDF` ficam lado a lado na superfície exibida imediatamente após confirmar o pagamento.
- Papel exposto na UI: `58 mm` e `80 mm`; automático: `58 -> 32 colunas`, `80 -> 48 colunas`; manual: `32|42|48`.
- Preferências persistidas vencem variáveis de ambiente; variáveis legadas continuam fallback para instalações existentes.
- Branding/conteúdo do comprovante deve ser snapshot estável; mudar configuração depois não pode reescrever comprovante histórico já enfileirado.
- `printing.autoPrint=false` para instalação nova; instalação existente com comportamento legado deve ser migrada sem impressão duplicada.
- Admin/manager podem alterar configuração global; cashier somente visualiza estado.
- Compatibilidade: não adicionar dependência nativa nova; manter possibilidade de backport para a linha Legacy.

## Review Focus

1. **Clique duplo em Imprimir/Salvar PDF:** uma venda continua única; estoque/caixa nunca repetem e cada tentativa de saída é independente.
2. **Ausência/offline da impressora:** PDF continua funcionando e o modal de pós-venda permanece utilizável.
3. **Configuração inválida ou antiga:** `paperMm`, `columns` e flags inválidas não derrubam startup; resolver com erro controlado/default seguro conforme origem.
4. **Corrida logo após `completeSale`:** o comprovante deve estar disponível para a tela de pós-venda mesmo se o efeito `sale.completed` ainda estiver sendo drenado.
5. **Cancelamento/falha do Save As:** cancelar não é erro; falha de escrita/`printToPDF` apresenta erro e não altera a venda.

---

## Mapa de arquivos

### Criar

- `js/domains/printing/printing-preferences.js` — validação, defaults, migração/fallback e resolução 58/80 ↔ 32/48.
- `js/domains/printing/sale-receipt-service.js` — projeção canônica/snapshot de comprovante para uma venda concluída.
- `desktop/receipt-actions.cjs` — bridge seguro para buscar comprovante, imprimir e salvar PDF.
- `desktop/renderer/printing-settings-ui.js` — seção de configuração de impressão em Configurações.
- `test/printing-preferences.test.js` — preferências/fallback/migração.
- `test/sale-receipt-service.test.js` — projeção canônica e venda concluída.
- `test/receipt-actions.test.js` — IPC/PDF/listagem/impressão/falhas.
- `test/post-sale-print-pdf-ui.test.js` — contrato de pós-venda e configurações.
- `qa/flows/post-sale-print-pdf.json` — E2E venda → PDF real.
- `qa/flows/printing-settings-e2e.json` — E2E persistência 58/80 e permissões.

### Modificar

- `js/core/pdv-runtime.js` — instanciar `saleReceipts` e injetar preferências no efeito de impressão.
- `js/domains/printing/print-effects.js` — gerar job através da mesma projeção canônica.
- `js/domains/printing/print-service.js` — localizar snapshot original por venda e criar tentativa manual auditável sem tocar na venda.
- `server/router.js` — expor comprovante canônico e endpoints mínimos de tentativa/resultado de impressão.
- `desktop/hardware-runtime.cjs` — resolver preferências dinamicamente e carregar papel/device por tentativa.
- `vendor/artisys-printing/src/drivers/electron-printer.js` — medir conteúdo e usar `pageSize` customizado para 58/80 quando suportado.
- `desktop/hardware-bridge.cjs` — listagem sanitizada de impressoras e impressão explícita com preferências.
- `desktop/main.cjs` — registrar receipt bridge, resolver settings e ajustar auto-print.
- `desktop/preload.cjs` — namespace estreito `receipts` e `hardware.listPrinters`.
- `desktop/renderer/api-client.js` — `saleReceipt`, configuração e tentativa de impressão.
- `desktop/renderer/app.js` — `completedSale`, modal de pós-venda e ações.
- `desktop/renderer/operational-pages.js` — montar seção Impressão dentro de Configurações.
- `desktop/renderer/index.html` — carregar `printing-settings-ui.js`.
- `desktop/renderer/styles.css` — layout pós-venda/configuração sem regressão em 1366×768.
- `qa/runtime/src/steps.js` — `expectFile` e validação de assinatura/tamanho/mtime.
- `qa/artisys-qa.config.json` — registrar os dois fluxos em `full` e `release`.
- `package.json` — incluir novos arquivos em `lint:core`/`lint:desktop` quando aplicável.
- `docs/operations/hardware-printing.md`, `docs/architecture/e13-e20.md`, `README.md`, `release/release-notes.md` — documentação da nova operação.

---

### Task 1: Preferências de impressão persistentes e compatíveis

**Files:**
- Create: `js/domains/printing/printing-preferences.js`
- Test: `test/printing-preferences.test.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `columnsForPaper(paperMm) -> 32|48`.
- Produces: `resolvePrintingPreferences({settings,env,isExistingInstall}) -> {deviceName,paperMm,columns,columnsMode,autoPrint,showSystemDialog,cut,openDrawerAfterPrint}`.
- Produces: `validatePrintingPreferences(input) -> normalizedPreferences`.
- Consumes: `settings.get(key,{scope:'global',defaultValue})` e variáveis `PDV_PRINTER_NAME`, `PDV_RECEIPT_WIDTH`, `PDV_AUTO_PRINT`, `PDV_PRINT_SILENT`, `PDV_PRINTER_CUT`, `PDV_PRINTER_OPEN_DRAWER`.

- [ ] **Step 1: Escrever os testes RED de papel/colunas, precedência e validação**

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const {columnsForPaper,resolvePrintingPreferences,validatePrintingPreferences}=require('../js/domains/printing/printing-preferences');

test('paper presets map to receipt columns',()=>{
  assert.equal(columnsForPaper(58),32);
  assert.equal(columnsForPaper(80),48);
});

test('persisted settings override legacy env',()=>{
  const values=new Map([
    ['printing.paperMm',80],['printing.columnsMode','manual'],['printing.columns',42],['printing.autoPrint',false],['printing.deviceName','POS80 Printer']
  ]);
  const settings={get:(key,{defaultValue})=>values.has(key)?values.get(key):defaultValue};
  const resolved=resolvePrintingPreferences({settings,env:{PDV_RECEIPT_WIDTH:'32',PDV_AUTO_PRINT:'true',PDV_PRINTER_NAME:'OLD'}});
  assert.equal(resolved.paperMm,80);
  assert.equal(resolved.columns,42);
  assert.equal(resolved.autoPrint,false);
  assert.equal(resolved.deviceName,'POS80 Printer');
});

test('new install defaults to manual post-sale printing',()=>{
  const settings={get:(_key,{defaultValue})=>defaultValue};
  assert.equal(resolvePrintingPreferences({settings,env:{},isExistingInstall:false}).autoPrint,false);
});

test('invalid paper and columns are rejected',()=>{
  assert.throws(()=>validatePrintingPreferences({paperMm:70,columnsMode:'auto'}),/58 ou 80/);
  assert.throws(()=>validatePrintingPreferences({paperMm:80,columnsMode:'manual',columns:40}),/32, 42 ou 48/);
});
```

- [ ] **Step 2: Rodar o teste e confirmar RED**

Run: `node --test test/printing-preferences.test.js`

Expected: FAIL com `Cannot find module '../js/domains/printing/printing-preferences'`.

- [ ] **Step 3: Implementar o resolver mínimo**

```js
'use strict';
const WIDTHS=new Set([32,42,48]);
const PAPERS=new Set([58,80]);
const bool=(value,fallback=false)=>value==null||value===''?fallback:String(value).toLowerCase()==='true';
function columnsForPaper(paperMm){const paper=Number(paperMm);if(paper===58)return 32;if(paper===80)return 48;throw new Error('Papel deve ser 58 ou 80 mm.');}
function validatePrintingPreferences(input={}){
  const paperMm=Number(input.paperMm??80);if(!PAPERS.has(paperMm))throw new Error('Papel deve ser 58 ou 80 mm.');
  const columnsMode=String(input.columnsMode||'auto');if(!['auto','manual'].includes(columnsMode))throw new Error('Modo de largura invalido.');
  const columns=columnsMode==='auto'?columnsForPaper(paperMm):Number(input.columns);if(!WIDTHS.has(columns))throw new Error('Largura deve ser 32, 42 ou 48 colunas.');
  return {deviceName:String(input.deviceName||'').trim()||null,paperMm,columnsMode,columns,autoPrint:Boolean(input.autoPrint),showSystemDialog:Boolean(input.showSystemDialog),cut:Boolean(input.cut),openDrawerAfterPrint:Boolean(input.openDrawerAfterPrint)};
}
```

Complete `resolvePrintingPreferences()` usando `settings.get()` primeiro, env legado depois e defaults por último. `showSystemDialog` deve ser o inverso seguro de impressão silenciosa quando ainda não houver setting persistido.

- [ ] **Step 4: Adicionar casos de instalação existente e flags legadas**

```js
test('legacy install keeps explicit legacy auto-print flag',()=>{
  const settings={get:(_key,{defaultValue})=>defaultValue};
  assert.equal(resolvePrintingPreferences({settings,env:{PDV_AUTO_PRINT:'true'},isExistingInstall:true}).autoPrint,true);
  assert.equal(resolvePrintingPreferences({settings,env:{PDV_AUTO_PRINT:'false'},isExistingInstall:true}).autoPrint,false);
});
```

Para `PDV_AUTO_PRINT` ausente: `isExistingInstall=true` preserva o legado (`true`); `false` usa o novo default (`false`). `main.cjs` determinará instalação existente pela existência prévia do DB antes de `createPdvRuntime()`.

- [ ] **Step 5: Rodar teste e lint direcionado**

Run: `node --test test/printing-preferences.test.js && node --check js/domains/printing/printing-preferences.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/domains/printing/printing-preferences.js test/printing-preferences.test.js js/core/pdv-runtime.js package.json
git commit -m "feat: add persistent printing preferences"
```

---

### Task 2: Projeção canônica de comprovante e snapshot por venda

**Files:**
- Create: `js/domains/printing/sale-receipt-service.js`
- Test: `test/sale-receipt-service.test.js`
- Modify: `js/domains/printing/print-effects.js`
- Modify: `js/domains/printing/print-service.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `server/router.js`
- Modify: `desktop/renderer/api-client.js`

**Interfaces:**
- Produces: `saleReceipts.build(saleId,{width}) -> {saleId,saleNumber,width,text,logoDataUrl,paperMm}`.
- Produces: `printing.getOriginalSaleReceipt(saleId) -> printJob|null`.
- Produces API: `GET /api/v1/sales/:saleId/receipt` autenticada, somente `COMPLETED`.
- Produces ApiClient: `saleReceipt(id)`.

- [ ] **Step 1: Escrever teste RED de projeção compartilhada**

```js
test('completed sale receipt uses the canonical renderer and branding snapshot',()=>{
  const service=createSaleReceiptService({
    saleService:{getSaleDetails:()=>({id:'s1',saleNumber:'V-1',status:'COMPLETED',totalCents:1000,subtotalCents:1000,items:[],payments:[]})},
    settings:{get:(key,{defaultValue})=>key==='store.name'?'Loja QA':defaultValue},
    resolvePreferences:()=>({paperMm:80,columns:48})
  });
  const receipt=service.build('s1');
  assert.equal(receipt.saleId,'s1');
  assert.equal(receipt.width,48);
  assert.equal(receipt.paperMm,80);
  assert.match(receipt.text,/Loja QA/);
  assert.match(receipt.text,/V-1/);
});

test('open or cancelled sale cannot be exported as post-sale receipt',()=>{
  const service=createSaleReceiptService({saleService:{getSaleDetails:()=>({id:'s1',saleNumber:'V-1',status:'OPEN'})},resolvePreferences:()=>({paperMm:80,columns:48})});
  assert.throws(()=>service.build('s1'),/Venda concluida/);
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `node --test test/sale-receipt-service.test.js`

Expected: FAIL por módulo ausente.

- [ ] **Step 3: Implementar `createSaleReceiptService` reutilizando código existente**

```js
function createSaleReceiptService({saleService,settings=null,resolvePreferences}={}){
  function build(saleId,options={}){
    const sale=saleService.getSaleDetails(String(saleId));
    if(!sale||sale.status!=='COMPLETED')throw new Error('Venda concluida obrigatoria para comprovante.');
    const prefs=resolvePreferences();
    const width=Number(options.width||prefs.columns);
    const branding=resolveReceiptBranding({settings,defaults:{name:'ArtiSys'}});
    return {saleId:sale.id,saleNumber:sale.saleNumber,width,paperMm:prefs.paperMm,text:renderSaleReceipt({branding,sale,width}),logoDataUrl:branding.logoDataUrl||null};
  }
  return Object.freeze({build});
}
```

- [ ] **Step 4: Fazer `print-effects` consumir `saleReceipts.build()`**

O handler `receipt.sale-completed` não deve mais renderizar seu próprio texto. Deve receber `saleReceipts` e enfileirar exatamente o snapshot retornado:

```js
const receipt=saleReceipts.build(event.aggregateId);
return printService.queueJob({
  id:`receipt-${event.eventId}`,
  type:'SALE_RECEIPT',entityType:'sale',entityId:receipt.saleId,width:receipt.width,
  payload:{text:receipt.text,paperMm:receipt.paperMm,...(receipt.logoDataUrl?{logoDataUrl:receipt.logoDataUrl}:{})}
});
```

- [ ] **Step 5: Proteger snapshot histórico no `PrintService`**

Adicionar:

```js
function getOriginalSaleReceipt(saleId){
  return listJobs({entityType:'sale',entityId:String(saleId)}).find(job=>job.type==='SALE_RECEIPT')||null;
}
```

O endpoint de receipt deve preferir o job original já criado; somente se o efeito ainda não tiver drenado deve chamar `saleReceipts.build()` para evitar corrida pós-checkout. Nunca aceitar OPEN/CANCELLED.

- [ ] **Step 6: Adicionar teste de corrida e snapshot**

```js
test('receipt API can project immediately and later returns queued snapshot unchanged',async()=>{
  // complete sale -> request receipt before drain -> capture text
  // drain outbox -> request again -> text must be byte-for-byte equal
});
```

Implementar no arquivo de teste API existente mais próximo (`test/e13-e20-api-ui.test.js`) ou em `test/sale-receipt-service.test.js` com fixture HTTP se isso mantiver o teste menor.

- [ ] **Step 7: Rodar testes**

Run: `node --test test/sale-receipt-service.test.js test/e19-printing.test.js test/e13-e20-api-ui.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/domains/printing/sale-receipt-service.js js/domains/printing/print-effects.js js/domains/printing/print-service.js js/core/pdv-runtime.js server/router.js desktop/renderer/api-client.js test/sale-receipt-service.test.js test/e19-printing.test.js test/e13-e20-api-ui.test.js
git commit -m "feat: expose canonical completed-sale receipts"
```

---

### Task 3: Bridge Electron seguro para imprimir e salvar PDF

**Files:**
- Create: `desktop/receipt-actions.cjs`
- Test: `test/receipt-actions.test.js`
- Modify: `desktop/main.cjs`
- Modify: `desktop/preload.cjs`
- Modify: `desktop/hardware-bridge.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces IPC: `artisys:receipts:print-sale` input `{saleId,sessionToken}`.
- Produces IPC: `artisys:receipts:save-pdf` input `{saleId,sessionToken}`.
- Produces preload: `artisysDesktop.receipts.printSale(saleId,sessionToken)` e `.saveSalePdf(saleId,sessionToken)`.
- Produces preload: `artisysDesktop.hardware.listPrinters()`.
- Consumes API canônica de Task 2.
- Consumes `hardwareController.print({text,width,paperMm,logoDataUrl})`.

- [ ] **Step 1: Escrever testes RED do bridge**

Use fakes de `BrowserWindow`, `dialog`, `fs` e fetch do receipt. Cobrir:

```js
test('savePdf writes a real PDF buffer returned by printToPDF',async()=>{
  const writes=[];
  const actions=createReceiptActions({
    BrowserWindow:FakePdfWindow,
    dialog:{showSaveDialog:async()=>({canceled:false,filePath:'C:/tmp/Venda-V-1.pdf'})},
    writeFile:async(path,buffer)=>writes.push({path,buffer}),
    fetchReceipt:async()=>({saleId:'s1',saleNumber:'V-1',paperMm:80,width:48,text:'CUPOM'})
  });
  const result=await actions.saveSalePdf({saleId:'s1',sessionToken:'token'});
  assert.equal(result.cancelled,false);
  assert.equal(writes.length,1);
  assert.equal(writes[0].buffer.subarray(0,5).toString(),'%PDF-');
});

test('savePdf cancellation is not an error',async()=>{ /* showSaveDialog => canceled:true; assert {cancelled:true} and zero writes */ });
test('printSale does not mutate sale and delegates only to printer',async()=>{ /* assert fetch once + hardware print once */ });
test('untrusted IPC sender is rejected',async()=>{ /* register bridge and invoke fake handler */ });
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `node --test test/receipt-actions.test.js`

Expected: FAIL por módulo ausente.

- [ ] **Step 3: Implementar `createReceiptActions()`**

Requisitos concretos:

```js
function safeSuggestedPdfName(receipt){
  const number=String(receipt.saleNumber||receipt.saleId).replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'venda';
  const date=String(receipt.completedAt||new Date().toISOString()).slice(0,10);
  return `Venda-${number}-${date}.pdf`;
}
```

A janela oculta deve usar `sandbox:true`, `nodeIntegration:false`, `contextIsolation:true`; HTML deve conter somente conteúdo escapado e `data:image/png;base64` já validado pelo helper existente. Após `loadURL`, medir `document.documentElement.scrollHeight`; converter px para microns (`25400/96`) e chamar:

```js
await window.webContents.printToPDF({
  printBackground:true,
  pageSize:{width:receipt.paperMm*1000,height:Math.max(10000,Math.ceil(contentHeightPx*(25400/96)))}
});
```

- [ ] **Step 4: Implementar Save As sem aceitar path do renderer**

Produção sempre chama `dialog.showSaveDialog({defaultPath:safeSuggestedPdfName(receipt),filters:[{name:'PDF',extensions:['pdf']}]})`. Em `ARTISYS_QA=1`, somente quando `ARTISYS_QA_PDF_DIR` estiver definido pelo processo de teste, o main pode construir internamente o caminho nesse diretório; nenhum path continua vindo do renderer.

- [ ] **Step 5: Registrar IPC/preload e listagem sanitizada**

`hardware.listPrinters()` deve retornar apenas:

```js
printers.map(p=>({name:String(p.name||''),displayName:String(p.displayName||p.name||''),isDefault:Boolean(p.isDefault),status:Number.isFinite(Number(p.status))?Number(p.status):null})).filter(p=>p.name)
```

A origem IPC deve reutilizar `trustedSender` de `main.cjs`.

- [ ] **Step 6: Rodar testes e lints**

Run: `node --test test/receipt-actions.test.js test/e18-hardware.test.js && node --check desktop/receipt-actions.cjs && node --check desktop/preload.cjs && node --check desktop/hardware-bridge.cjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/receipt-actions.cjs desktop/main.cjs desktop/preload.cjs desktop/hardware-bridge.cjs test/receipt-actions.test.js package.json
git commit -m "feat: add native receipt print and PDF actions"
```

---

### Task 4: Aplicar preferências reais no hardware e papel 58/80

**Files:**
- Modify: `desktop/hardware-runtime.cjs`
- Modify: `vendor/artisys-printing/src/drivers/electron-printer.js`
- Test: `test/hardware-runtime.test.js`
- Test: `test/receipt-branding.test.js`
- Test: `test/e54-1-hardware-simulation.test.js`

**Interfaces:**
- Consumes: `resolvePrintingPreferences()` da Task 1.
- `createPdvHardwareRuntime({BrowserWindow,env,resolvePrinterPreferences})` resolve profile em cada tentativa.
- `electronPrinter.print(rendered,profile)` aceita `rendered.paperMm` e mede altura antes de `webContents.print()`.

- [ ] **Step 1: Escrever testes RED de profile dinâmico**

```js
test('runtime uses persisted 80mm preferences at print time',async()=>{
  let prefs={deviceName:'POS80 Printer',paperMm:80,columns:48,showSystemDialog:true,cut:true,openDrawerAfterPrint:false};
  const runtime=createPdvHardwareRuntime({BrowserWindow:FakeWindow,env:{},resolvePrinterPreferences:()=>prefs,modules:fakeModules});
  await runtime.print({text:'cupom'});
  assert.equal(fakeModules.lastProfile.deviceName,'POS80 Printer');
  assert.equal(fakeModules.lastProfile.width,48);
});
```

Adicionar caso alterando `prefs` entre duas chamadas para provar que não fica congelado no startup.

- [ ] **Step 2: Confirmar RED**

Run: `node --test test/hardware-runtime.test.js test/receipt-branding.test.js`

Expected: FAIL porque o runtime atual fixa env/profile no startup e o driver não usa `paperMm`.

- [ ] **Step 3: Resolver profile por tentativa**

`hardware-runtime.cjs` deve chamar `resolvePrinterPreferences()` em `print()`, `testPrinter()` e `diagnostics()`. Para modos `thermal/serial`, manter validações atuais de interface/porta e aplicar apenas preferências compatíveis (`width`, cut/drawer).

- [ ] **Step 4: Medir recibo e enviar pageSize customizado no driver Electron**

Após `loadURL`, medir a altura:

```js
const contentHeightPx=await window.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
const pageSize=input.paperMm?{width:Number(input.paperMm)*1000,height:Math.max(10000,Math.ceil(contentHeightPx*(25400/96)))}:undefined;
```

Passar `pageSize` somente quando válido. A4 continua exatamente como antes.

- [ ] **Step 5: Testar 58 mm e 80 mm**

Adicionar FakeWindow capturando opções de `webContents.print` e validar `58000`/`80000`, largura de texto 32/48 e ausência de regressão no A4.

- [ ] **Step 6: Rodar hardware tests**

Run: `node --test test/hardware-runtime.test.js test/receipt-branding.test.js test/e54-1-hardware-simulation.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/hardware-runtime.cjs vendor/artisys-printing/src/drivers/electron-printer.js test/hardware-runtime.test.js test/receipt-branding.test.js test/e54-1-hardware-simulation.test.js
git commit -m "feat: apply 58mm and 80mm printer profiles"
```

---

### Task 5: Configurações > Impressão

**Files:**
- Create: `desktop/renderer/printing-settings-ui.js`
- Create: `test/post-sale-print-pdf-ui.test.js`
- Modify: `desktop/renderer/operational-pages.js`
- Modify: `desktop/renderer/index.html`
- Modify: `desktop/renderer/styles.css`
- Modify: `desktop/renderer/api-client.js`

**Interfaces:**
- Produces: `window.PdvPrintingSettingsUi.mount({container,api,desktop,user,showToast})`.
- Consumes: `api.settings({scope:'global',prefix:'printing.'})`, `api.saveSetting(...)`, `artisysDesktop.hardware.listPrinters()`, `hardware.testPrinter()`.

- [ ] **Step 1: Escrever teste de contrato UI RED**

```js
test('settings exposes printer, paper and test controls',()=>{
  const source=read('desktop/renderer/printing-settings-ui.js');
  for(const marker of ['printing-device','printing-paper','printing-columns-mode','printing-columns','printing-auto-print','printing-system-dialog','printing-cut','printing-drawer','printing-save','printing-test']) assert.match(source,new RegExp(marker));
  assert.match(source,/58 mm/);
  assert.match(source,/80 mm/);
});
```

No mesmo teste, afirmar que `operational-pages.js` possui host `[data-printing-settings]` e chama o mount somente se a rota `settings` continuar ativa.

- [ ] **Step 2: Confirmar RED**

Run: `node --test test/post-sale-print-pdf-ui.test.js`

Expected: FAIL por arquivo ausente.

- [ ] **Step 3: Implementar a seção**

A seção deve renderizar select de impressoras e todos os campos aprovados. `columns` fica disabled quando `columnsMode==='auto'` e mostra o valor derivado 32/48. Sem impressora, mostrar `Nenhuma impressora instalada; Salvar PDF continua disponível.`.

- [ ] **Step 4: Implementar RBAC visual e efetivo**

`admin|manager`: campos e salvar habilitados. `cashier`: controles disabled e sem chamada `saveSetting`. O servidor continua sendo a autoridade de permissão; a UI apenas evita ação impossível.

- [ ] **Step 5: Persistir as oito chaves explicitamente**

```js
await Promise.all([
  api.saveSetting('printing.deviceName',deviceName,'global'),
  api.saveSetting('printing.paperMm',paperMm,'global'),
  api.saveSetting('printing.columnsMode',columnsMode,'global'),
  api.saveSetting('printing.columns',columns,'global'),
  api.saveSetting('printing.autoPrint',autoPrint,'global'),
  api.saveSetting('printing.showSystemDialog',showSystemDialog,'global'),
  api.saveSetting('printing.cut',cut,'global'),
  api.saveSetting('printing.openDrawerAfterPrint',openDrawerAfterPrint,'global')
]);
```

- [ ] **Step 6: Testar 1366×768 e sem overflow horizontal no fluxo QA posteriormente**

Nesta task, garantir CSS com grid responsivo e rolagem interna da página operacional, sem `position:fixed` novo.

- [ ] **Step 7: Rodar testes/lint**

Run: `node --test test/post-sale-print-pdf-ui.test.js test/operational-route-stability.test.js test/e23-settings.test.js && node --check desktop/renderer/printing-settings-ui.js && node --check desktop/renderer/operational-pages.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/renderer/printing-settings-ui.js desktop/renderer/operational-pages.js desktop/renderer/index.html desktop/renderer/styles.css desktop/renderer/api-client.js test/post-sale-print-pdf-ui.test.js
git commit -m "feat: add printer settings UI"
```

---

### Task 6: Pós-venda com Imprimir e Salvar PDF lado a lado

**Files:**
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/styles.css`
- Modify: `test/post-sale-print-pdf-ui.test.js`
- Modify: `test/ux-home-checkout-preservation.test.js`

**Interfaces:**
- `state.completedSale` guarda snapshot retornado por `completeSale` até fechar/iniciar nova venda.
- `showCompletedSale(result)` renderiza modal pós-venda.
- Consumes: `artisysDesktop.receipts.printSale(completed.id,api.sessionToken)` e `.saveSalePdf(...)`.

- [ ] **Step 1: Escrever teste RED do contrato pós-venda**

```js
test('checkout completion exposes print and PDF sibling actions',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/id="post-sale-print"/);
  assert.match(app,/id="post-sale-pdf"/);
  assert.match(app,/id="post-sale-new-sale"/);
  assert.match(app,/completedSale/);
  assert.doesNotMatch(app,/completeCurrentSale\(\)[\s\S]*showToast\(`Venda[^]*renderCheckout\(\);\s*}\s*catch/);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test test/post-sale-print-pdf-ui.test.js test/ux-home-checkout-preservation.test.js`

Expected: FAIL porque a conclusão atual só limpa estado/toast/render.

- [ ] **Step 3: Implementar estado e modal**

Após `api.completeSale`:

```js
const completed=result.sale;
state.completedSale=completed;
state.sale=null;
state.selectedProductId=null;
state.discountPercent=0;
state.paymentDraft=[];
state.products=await api.products();
renderCheckout();
showCompletedSale(completed);
```

O modal deve conter número, total, troco e o grupo:

```html
<div class="post-sale-output-actions">
  <button id="post-sale-print" class="primary-button">Imprimir</button>
  <button id="post-sale-pdf" class="primary-button">Salvar PDF</button>
</div>
<button id="post-sale-new-sale" class="secondary-button">Iniciar nova venda</button>
```

- [ ] **Step 4: Implementar ações sem fechar modal em erro**

`Imprimir`: desabilitar somente durante await; sucesso mostra `Impressão enviada.`; erro mostra toast e mantém ambos os botões utilizáveis.

`Salvar PDF`: `{cancelled:true}` não gera toast de erro; sucesso mostra `PDF salvo.`; falha mantém modal.

`Iniciar nova venda`: zera `state.completedSale`, fecha modal, chama `newSale()`.

- [ ] **Step 5: Proteger clique duplo**

Cada botão usa flag local `busy`; dois cliques simultâneos na mesma ação geram uma chamada. A flag não é compartilhada entre PDF e impressão, então uma falha de impressora não bloqueia PDF.

- [ ] **Step 6: Rodar testes**

Run: `node --test test/post-sale-print-pdf-ui.test.js test/ux-home-checkout-preservation.test.js test/desktop-shell.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/renderer/app.js desktop/renderer/styles.css test/post-sale-print-pdf-ui.test.js test/ux-home-checkout-preservation.test.js
git commit -m "feat: add post-sale print and PDF actions"
```

---

### Task 7: Auto-print controlado e tentativa manual auditável

**Files:**
- Modify: `desktop/main.cjs`
- Modify: `js/domains/printing/print-service.js`
- Modify: `server/router.js`
- Modify: `desktop/receipt-actions.cjs`
- Test: `test/e19-printing.test.js`
- Test: `test/receipt-actions.test.js`

**Interfaces:**
- Produces: `printing.createManualAttempt(saleId) -> REPRINT job baseado no snapshot original`.
- Produces API interna/autenticada para registrar resultado da tentativa manual sem tocar em venda/estoque/caixa.
- `startPrintWorker()` consulta `resolvePrintingPreferences(...).autoPrint`; não usa mais apenas `process.env.PDV_AUTO_PRINT`.

- [ ] **Step 1: Escrever teste RED de tentativa manual**

```js
test('manual attempt clones receipt but never emits sale.completed again',()=>{
  const original=service.queueJob({id:'receipt-event-1',type:'SALE_RECEIPT',entityType:'sale',entityId:'s1',payload:{text:'snapshot'},width:48});
  const manual=service.createManualAttempt('s1');
  assert.equal(manual.type,'REPRINT');
  assert.equal(manual.entityId,'s1');
  assert.equal(manual.payload.text,'snapshot');
  assert.equal(manual.payload.reprintOf,original.id);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test test/e19-printing.test.js test/receipt-actions.test.js`

- [ ] **Step 3: Implementar manual attempt e outcome**

A tentativa explícita deve ganhar um job próprio. Em sucesso `markPrinted(jobId)`; em falha `markFailed(jobId,error)`. Nenhum caminho chama `sales.completeSale`, inventory ou cash.

- [ ] **Step 4: Alterar worker de auto-print**

O tick só processa `PENDING` automaticamente quando `autoPrint===true`. Ao mudar setting para false em runtime, o próximo tick para de consumir novos jobs sem restart; os jobs permanecem auditáveis.

- [ ] **Step 5: Evitar corrida entre worker e clique manual**

A ação manual cria seu próprio job `REPRINT`; não reutiliza o `PENDING` original. Assim o worker e o clique nunca disputam o mesmo job. O original continua sendo snapshot/base histórica.

- [ ] **Step 6: Rodar testes**

Run: `node --test test/e19-printing.test.js test/receipt-actions.test.js test/hardware-runtime.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/main.cjs desktop/receipt-actions.cjs js/domains/printing/print-service.js server/router.js test/e19-printing.test.js test/receipt-actions.test.js
git commit -m "feat: make manual receipt printing auditable"
```

---

### Task 8: ArtiSys QA — validar arquivo PDF real

**Files:**
- Modify: `qa/runtime/src/steps.js`
- Test: `test/qa-runtime.test.js` ou teste QA equivalente já existente
- Modify: `qa/artisys-qa.config.json`
- Create: `qa/flows/post-sale-print-pdf.json`
- Create: `qa/flows/printing-settings-e2e.json`

**Interfaces:**
- Produces action QA `expectFile` com `{path|directory,pattern,minBytes,startsWith,createdAfterRunStart}`.
- Consumes `runtimeContext.startedAt` quando disponível; caso contrário captura `Date.now()` no início do runner e propaga.

- [ ] **Step 1: Escrever teste RED do `expectFile`**

```js
test('expectFile rejects stale or non-PDF artifacts',async()=>{
  // criar arquivo antigo/HTML e esperar rejeição
});
test('expectFile accepts newly generated PDF with minimum size',async()=>{
  // criar Buffer.from('%PDF-1.7\n' + 'x'.repeat(200)); esperar PASS
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test test/qa-runtime.test.js`

Expected: FAIL com `Unsupported QA action: expectFile`.

- [ ] **Step 3: Implementar `expectFile` sem dependência externa**

Para `directory+pattern`, usar `fs.readdir`, converter somente `*` para regex segura e selecionar arquivo com `mtimeMs >= runStartedAt`. Validar `stat.size >= minBytes`; quando `startsWith` existir, ler somente bytes necessários e comparar exatamente.

- [ ] **Step 4: Criar E2E `post-sale-print-pdf`**

Fluxo obrigatório:

```text
home/login/setup
→ criar produto sem estoque
→ balcão
→ adicionar produto
→ abrir caixa se necessário
→ finalizar/pagar
→ esperar #post-sale-print e #post-sale-pdf
→ expectVisible ambos
→ screenshot do modal
→ clicar Salvar PDF
→ expectFile directory=qa-artifacts/generated-pdf pattern=Venda-*.pdf minBytes=100 startsWith=%PDF-
→ clicar Imprimir com impressora simulada/adapter de QA
→ iniciar nova venda
→ confirmar carrinho vazio e checkout utilizável
```

Definir em ambiente QA `ARTISYS_QA_PDF_DIR=qa-artifacts/generated-pdf`; limpar somente esse diretório no setup do fluxo/runner antes da execução para impedir falso positivo de arquivo antigo.

- [ ] **Step 5: Criar E2E `printing-settings-e2e`**

Fluxo:

```text
Configurações → Impressão
→ selecionar 80 mm → automático → salvar
→ sair e voltar → confirmar 80/48
→ reload → confirmar persistência
→ trocar para 58 mm → automático → salvar
→ reload → confirmar 58/32
→ expectNoHorizontalOverflow em 1366×768
```

O adapter QA deve fornecer pelo menos uma impressora simulada somente no processo de teste, sem alterar comportamento de produção. Adicionar cenário separado com lista vazia e confirmar texto `Salvar PDF continua disponível`.

- [ ] **Step 6: Registrar fluxos em `full` e `release` como críticos**

Adicionar ambos a `flows`, `qaProfiles.full.flows/criticalFlows` e `qaProfiles.release.flows/criticalFlows`.

- [ ] **Step 7: Validar schema e rodar E2E direcionado**

Run:

```bash
npm run qa:validate
node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow post-sale-print-pdf --environment ci --viewport desktop --output qa-artifacts
node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow printing-settings-e2e --environment ci --viewport desktop --output qa-artifacts
```

Expected: ambos PASS e PDF recém-criado começa com `%PDF-`.

- [ ] **Step 8: Commit**

```bash
git add qa/runtime/src/steps.js qa/artisys-qa.config.json qa/flows/post-sale-print-pdf.json qa/flows/printing-settings-e2e.json test/qa-runtime.test.js
git commit -m "test: add end-to-end receipt PDF coverage"
```

---

### Task 9: Falhas, regressão e documentação operacional

**Files:**
- Modify: `test/receipt-actions.test.js`
- Modify: `test/post-sale-print-pdf-ui.test.js`
- Modify: `docs/operations/hardware-printing.md`
- Modify: `docs/architecture/e13-e20.md`
- Modify: `README.md`
- Modify: `release/release-notes.md`

**Interfaces:**
- Nenhuma interface nova; consolida os contratos anteriores.

- [ ] **Step 1: Adicionar testes dos cinco itens de Review Focus**

Cobertura obrigatória:

```text
1. dois cliques simultâneos -> uma chamada por botão;
2. printer.print rejeita -> saveSalePdf ainda funciona;
3. config inválida -> erro controlado, startup não corrompe setting existente;
4. receipt solicitado imediatamente após completeSale -> disponível e depois igual ao snapshot;
5. Save As cancelado / writeFile falha / printToPDF falha -> venda continua COMPLETED e modal permanece utilizável.
```

- [ ] **Step 2: Rodar suíte direcionada completa**

Run:

```bash
node --test test/printing-preferences.test.js test/sale-receipt-service.test.js test/receipt-actions.test.js test/post-sale-print-pdf-ui.test.js test/e18-hardware.test.js test/e19-printing.test.js test/hardware-runtime.test.js test/receipt-branding.test.js test/e54-1-hardware-simulation.test.js test/ux-home-checkout-preservation.test.js
```

Expected: PASS.

- [ ] **Step 3: Atualizar documentação na mesma entrega**

Documentar exatamente:

- onde selecionar impressora;
- 58/80 mm e 32/42/48;
- prioridade settings → env legado → default;
- diferença entre `Imprimir` e `Salvar PDF`;
- PDF não depende de Microsoft Print to PDF;
- venda não é revertida por falha de saída;
- retry/reimpressão e fila;
- auto-print opt-in para instalação nova;
- limitações de homologação física.

- [ ] **Step 4: Rodar verificações do repositório**

Run:

```bash
npm run docs:check
npm test
npm run lint:core
npm run lint:desktop
npm run qa:validate
npm run qa:full
```

Expected: PASS.

- [ ] **Step 5: Rodar gate de release**

Run: `npm run verify:release && npm run qa:release`

Expected: PASS.

- [ ] **Step 6: Conferir diff e ausência de dependências pagas/novas nativas**

Run:

```bash
git diff main...HEAD -- package.json package-lock.json
git diff --check
git status --short
```

Expected: nenhuma dependência paga/SaaS, nenhuma dependência nativa nova, `git diff --check` sem saída.

- [ ] **Step 7: Commit final de docs/regressões**

```bash
git add test docs README.md release/release-notes.md
git commit -m "docs: document receipt PDF and printer settings"
```

---

## Ordem de integração

1. Preferências e compatibilidade.
2. Comprovante canônico.
3. Bridge PDF/impressão.
4. Hardware 58/80.
5. Configurações UI.
6. Pós-venda.
7. Auditoria/manual + auto-print.
8. E2E/arquivo real.
9. Falhas, docs e gates de release.

Não fazer merge parcial antes de Task 9: as Tasks 2–7 alteram interfaces vizinhas e só formam a experiência completa juntas.

## Self-review

### Spec coverage

- Pós-venda com botões lado a lado: Task 6.
- PDF nativo sem impressora virtual/serviço externo: Task 3.
- Mesmo comprovante para impressão/PDF: Tasks 2 e 3.
- Configuração persistente e fallback legado: Tasks 1 e 5.
- 58/80 mm e 32/42/48: Tasks 1 e 4.
- Impressoras instaladas: Tasks 3 e 5.
- RBAC admin/manager/cashier: Task 5.
- Fila, retry e impressão manual auditável: Task 7.
- Auto-print opt-in sem bloquear venda: Tasks 1 e 7.
- E2E real e `%PDF-`: Task 8.
- Sem impressora/falhas/cancelamento: Tasks 8 e 9.
- Documentação: Task 9.

### Placeholder scan

Nenhum `TBD`, `TODO`, `implement later`, referência vaga a “testar acima” ou interface não definida foi deixada como instrução de implementação.

### Type/interface consistency

- `paperMm`: número `58|80` em todas as camadas.
- `columns`: número `32|42|48`.
- `columnsMode`: string `'auto'|'manual'`.
- `saleId`: string validada na API canônica.
- `saveSalePdf`: retorna `{cancelled:boolean,fileName?:string}`; nunca retorna caminho completo ao renderer.
- receipt snapshot: `{saleId,saleNumber,width,paperMm,text,logoDataUrl}`.

### Review Focus coverage

Os cinco riscos listados no cabeçalho possuem casos explícitos nas Tasks 2, 3, 6, 8 e 9.
