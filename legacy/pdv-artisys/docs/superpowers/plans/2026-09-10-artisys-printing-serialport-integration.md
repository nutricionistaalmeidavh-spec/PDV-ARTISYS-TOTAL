# ArtiSys Printing + SerialPort PDV Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `@artisys/serialport` and `@artisys/printing` into `PDV-ARTISYS` so scale, cash drawer and printer hardware use reusable ArtiSys modules while preserving the existing persistent print queue and Electron printing behavior by default.

**Architecture:** `PDV-ARTISYS` pins `utilidades` as `vendor/utilidades` and consumes both modules through `file:` dependencies. A new testable `desktop/hardware-runtime.cjs` composes scale, drawer and printer adapters from environment/configuration; `desktop/hardware-bridge.cjs` becomes only the PDV-facing controller + IPC boundary. Existing sale/restaurant renderers continue to own product-specific content, but reuse `@artisys/printing` formatting contracts. No automatic failover occurs after a configured printer starts a physical write, preventing accidental duplicate receipts.

**Tech Stack:** Node.js >=22, Electron 39, electron-builder 26, `@artisys/serialport` 0.1.0, `@artisys/printing` 0.1.0, Node built-in test runner.

**Spec:** `vendor/utilidades/docs/superpowers/specs/2026-09-10-artisys-printing-serialport-design.md` after the submodule is pinned. Canonical source before pinning: `nutricionistaalmeidavh-spec/utilidades/docs/superpowers/specs/2026-09-10-artisys-printing-serialport-design.md`.

## Global Constraints

- Default behavior with no new environment variables remains Electron printing with width `PDV_RECEIPT_WIDTH || 42`, `PDV_PRINTER_NAME`, and `PDV_PRINT_SILENT`.
- Existing `print_jobs` states and `print-service.js` ownership remain unchanged: `PENDING`, `PRINTED`, `FAILED`, `CANCELLED`, retry and reprint stay in the PDV.
- Core must work with R$ 0 license/subscription cost; no required cloud service or always-on external infrastructure.
- Node floor remains `>=22`.
- `serialport` native modules must remain unpacked from Electron ASAR.
- No direct `require('serialport')`, `require('receiptline')`, or `require('node-thermal-printer')` remains in PDV domain/desktop code after migration; only ArtiSys module APIs are consumed.
- `PDV_PRINTER_MODE` valid values are `electron`, `thermal`, `serial`; unset means `electron`.
- Do not automatically retry a failed thermal/serial print through Electron in the same job. The existing queue marks failure and a human/normal retry decides what happens next.

---

### Task 1: Pin `utilidades` and install module dependencies

**Files:**
- Create: `.gitmodules`
- Add gitlink: `vendor/utilidades`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/module-dependencies.test.js`

**Interfaces:**
- Consumes: a `utilidades` commit containing both implemented modules at `modules/artisys-serialport` and `modules/artisys-printing`.
- Produces: resolvable `require('@artisys/serialport')` and `require('@artisys/printing')` from the PDV root.

- [ ] **Step 1: Write dependency-resolution test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('ArtiSys hardware modules resolve from the pinned utilidades tree', () => {
  const serial = require('@artisys/serialport');
  const printing = require('@artisys/printing');
  assert.equal(typeof serial.createSerialTransport, 'function');
  assert.equal(typeof serial.createScaleAdapter, 'function');
  assert.equal(typeof printing.createElectronPrinterDriver, 'function');
  assert.equal(typeof printing.createThermalPrinterDriver, 'function');
});
```

- [ ] **Step 2: Run and confirm red**

Run: `node --test test/module-dependencies.test.js`

Expected: FAIL with module-not-found before the vendor pin/dependencies exist.

- [ ] **Step 3: Add the submodule pin**

From the PDV repository:

```bash
git submodule add https://github.com/nutricionistaalmeidavh-spec/utilidades.git vendor/utilidades
cd vendor/utilidades
git checkout <commit-containing-artisys-serialport-and-artisys-printing>
cd ../..
git add .gitmodules vendor/utilidades
```

The actual commit SHA must be the verified utilidades commit produced after both module plans pass; never pin `main` implicitly.

- [ ] **Step 4: Update package dependencies**

Keep `serialport` directly pinned at `13.0.0` for predictable native-module hoisting/rebuild, and add the two local packages:

```json
"dependencies": {
  "@artisys/printing": "file:vendor/utilidades/modules/artisys-printing",
  "@artisys/serialport": "file:vendor/utilidades/modules/artisys-serialport",
  "serialport": "13.0.0",
  "xlsx": "^0.18.5"
}
```

Run `npm install` to regenerate `package-lock.json` from this exact tree.

- [ ] **Step 5: Preserve native ASAR unpacking**

Keep existing patterns:

```json
"asarUnpack": [
  "node_modules/serialport/**/*",
  "node_modules/@serialport/**/*"
]
```

After `npm install`, verify `npm ls serialport` dedupes to 13.0.0. If npm nests a second copy inside the local package, fix dependency version alignment rather than adding divergent versions.

- [ ] **Step 6: Run dependency test**

Run: `node --test test/module-dependencies.test.js && npm ls serialport`

Expected: test PASS and one compatible SerialPort 13.0.0 tree.

- [ ] **Step 7: Commit**

```bash
git add .gitmodules vendor/utilidades package.json package-lock.json test/module-dependencies.test.js
git commit -m "build: pin artisys hardware modules"
```

---

### Task 2: Move concrete hardware assembly into a testable runtime

**Files:**
- Create: `desktop/hardware-runtime.cjs`
- Create: `test/hardware-runtime.test.js`
- Modify: `desktop/hardware-bridge.cjs`
- Modify: `package.json` (`lint:desktop`)

**Interfaces:**
- Consumes: `@artisys/serialport`, `@artisys/printing`, injected `BrowserWindow`, environment object.
- Produces: `createPdvHardwareRuntime({ BrowserWindow, env, modules? })` returning `{ status, readWeight?, tare?, openDrawer?, print }`.

- [ ] **Step 1: Write runtime tests with fully injected module fakes**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvHardwareRuntime } = require('../desktop/hardware-runtime.cjs');

test('defaults printer mode to electron', async () => {
  const calls=[];
  const runtime=createPdvHardwareRuntime({
    BrowserWindow:function(){}, env:{},
    modules:{
      serial:{ createSerialTransport(){ throw new Error('serial should not be used'); } },
      printing:{
        normalizePrinterProfile:p=>p,
        createElectronPrinterDriver:()=>({ print:async()=>{calls.push('electron');return {success:true};} }),
        createThermalPrinterDriver:()=>({ print:async()=>{calls.push('thermal');return {success:true};} }),
        createTransportPrinterDriver:()=>({ print:async()=>{calls.push('transport');return {success:true};} })
      }
    }
  });
  await runtime.print({ text:'cupom', width:42 });
  assert.deepEqual(calls, ['electron']);
});
```

- [ ] **Step 2: Run and confirm red**

Run: `node --test test/hardware-runtime.test.js`

Expected: FAIL because the runtime file does not exist.

- [ ] **Step 3: Implement environment/profile resolution**

Create helpers inside `hardware-runtime.cjs`:

```js
function bool(value, fallback=false){
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}
function printerMode(env){
  const mode=String(env.PDV_PRINTER_MODE || 'electron').toLowerCase();
  if (!['electron','thermal','serial'].includes(mode)) throw new Error('PDV_PRINTER_MODE invalido.');
  return mode;
}
```

Profile mapping:

```js
{
  id:'pdv-default',
  mode: mode === 'serial' ? 'transport' : mode,
  width:Number(env.PDV_RECEIPT_WIDTH || 42),
  printerType:String(env.PDV_PRINTER_TYPE || 'generic').toLowerCase(),
  interface:env.PDV_PRINTER_INTERFACE || null,
  deviceName:env.PDV_PRINTER_NAME || null,
  silent:bool(env.PDV_PRINT_SILENT),
  cut:bool(env.PDV_PRINTER_CUT)
}
```

- [ ] **Step 4: Compose scale and drawer through `@artisys/serialport`**

For a configured scale, create a serial transport, request/response session with `PDV_SCALE_COMMAND`, and scale adapter using `parseNumericWeight`. For a configured drawer, create a transport and drawer adapter. If a port is absent, do not instantiate it; status reports `{ available:false, reason:'not-configured' }`.

- [ ] **Step 5: Compose printer drivers**

- `electron`: `createElectronPrinterDriver({ BrowserWindow })`.
- `thermal`: `createThermalPrinterDriver()` and the normalized `thermal` profile.
- `serial`: create a serial transport from `PDV_PRINTER_PORT` (fallback to `PDV_PRINTER_INTERFACE` only when it is a plain serial path), wrap it with `createTransportPrinterDriver({ transport })`, normalize profile mode to `transport`.

`print(job)` sends `job.text` and the resolved profile. A configured mode failure propagates to the PDV queue; no cross-driver failover is attempted.

- [ ] **Step 6: Reduce `hardware-bridge.cjs` to controller + IPC**

Delete concrete `createElectronPrintDriver`, `createSerialScaleDriver`, and `createSerialDrawerDriver` from this file. Keep only `createHardwareController` and `registerHardwareIpc`, with the same existing IPC channels and validation so renderer behavior does not change.

Expected exports:

```js
module.exports = { createHardwareController, registerHardwareIpc };
```

- [ ] **Step 7: Add tests for scale/drawer/serial-printer selection**

Use module fakes to assert:

```js
assert.equal((await runtime.status()).scale.available, true);
assert.deepEqual(await runtime.readWeight(), { weight:1.25, unit:'kg' });
assert.equal(await runtime.openDrawer(), true);
```

Also assert `PDV_PRINTER_MODE=serial` selects the transport printer and `PDV_PRINTER_MODE=thermal` selects the thermal driver.

- [ ] **Step 8: Update syntax verification and run tests**

Add `node --check desktop/hardware-runtime.cjs` to `lint:desktop`.

Run: `node --test test/hardware-runtime.test.js && npm run lint:desktop`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/hardware-runtime.cjs desktop/hardware-bridge.cjs test/hardware-runtime.test.js package.json
git commit -m "refactor: compose hardware through artisys modules"
```

---

### Task 3: Wire the new runtime into Electron main

**Files:**
- Modify: `desktop/main.cjs`
- Modify: `test/desktop-shell.test.js`

**Interfaces:**
- Consumes: `createPdvHardwareRuntime`, existing `createHardwareController`/IPC boundary.
- Produces: live PDV hardware controller with the same renderer-facing IPC API.

- [ ] **Step 1: Add a structural regression test**

In `test/desktop-shell.test.js`, read `desktop/main.cjs` and assert:

```js
assert.match(mainSource, /createPdvHardwareRuntime/);
assert.doesNotMatch(mainSource, /require\(['"]serialport['"]\)/);
assert.doesNotMatch(mainSource, /createSerialScaleDriver/);
assert.doesNotMatch(mainSource, /createElectronPrintDriver/);
```

- [ ] **Step 2: Run and confirm red**

Run: `node --test test/desktop-shell.test.js`

Expected: FAIL because main still imports direct concrete drivers and `serialport`.

- [ ] **Step 3: Replace direct hardware imports**

Main imports become:

```js
const { createHardwareController, registerHardwareIpc } = require('./hardware-bridge.cjs');
const { createPdvHardwareRuntime } = require('./hardware-runtime.cjs');
```

Delete the direct `require('serialport')` try/catch and `SerialPortClass` variable from main.

- [ ] **Step 4: Replace `buildHardwareController()` implementation**

```js
function buildHardwareController() {
  const runtimeDriver = createPdvHardwareRuntime({ BrowserWindow, env:process.env });
  return createHardwareController(runtimeDriver);
}
```

Keep `startPrintWorker()` unchanged except for using the newly composed `hardwareController.print()` that it already calls.

- [ ] **Step 5: Run desktop and printing regressions**

Run:

```bash
node --test test/desktop-shell.test.js test/printing.test.js test/non-fiscal-printing.test.js 2>/dev/null || npm test
npm run lint:desktop
```

If named legacy test files differ, use `npm test`; do not skip the full suite.

Expected: all pre-existing queue/IPC behavior remains green.

- [ ] **Step 6: Commit**

```bash
git add desktop/main.cjs test/desktop-shell.test.js
git commit -m "feat: wire artisys hardware runtime into desktop"
```

---

### Task 4: Reuse ArtiSys printing primitives in PDV receipt renderers

**Files:**
- Modify: `js/domains/printing/receipt-renderer.js`
- Modify: `js/domains/printing/non-fiscal-renderer.js`
- Create: `test/artisys-print-renderers.test.js`

**Interfaces:**
- Consumes: `createReceiptDocument`, `renderPlainText`, `money`, `fit`, `center`, `columns` from `@artisys/printing`.
- Produces: the same PDV public renderer functions currently used by domain effects.

- [ ] **Step 1: Capture legacy sale-receipt behavior**

Add a test using the current public `renderSaleReceipt()` and assert sale number, operator, item quantity/price, total, payment and trailing newline. The expected business labels stay owned by the PDV.

```js
const text=renderSaleReceipt({ storeName:'Loja', sale:{
  saleNumber:'123', operatorName:'Maria', completedAt:'2026-09-10T10:00:00Z',
  items:[{productName:'Cafe', quantity:2, unitPriceCents:500, totalCents:1000}],
  subtotalCents:1000, totalCents:1000, payments:[{method:'PIX', amountCents:1000}]
}});
assert.match(text, /Venda: 123/);
assert.match(text, /Cafe/);
assert.match(text, /TOTAL/);
assert.match(text, /PIX/);
```

- [ ] **Step 2: Run baseline test before refactor**

Run: `node --test test/artisys-print-renderers.test.js`

Expected: PASS against the current renderer. This is a characterization test, not a red test; immediately add a second assertion that monkey-patches/module-loads `@artisys/printing` usage or a structural source assertion so the migration requirement is red before implementation.

- [ ] **Step 3: Refactor sale receipt to an ArtiSys document**

`receipt-renderer.js` imports:

```js
const { createReceiptDocument, renderPlainText, money, fit, center, columns } = require('@artisys/printing');
```

`renderSaleReceipt()` maps PDV sale fields into the neutral document:

```js
const document=createReceiptDocument({
  width,
  title:storeName,
  documentLabel,
  metadata:[
    ['Venda', sale.saleNumber],
    ['Data', sale.completedAt || sale.updatedAt || ''],
    ['Operador', sale.operatorName || sale.operatorId || ''],
    ...(sale.customerName || sale.customerId ? [['Cliente', sale.customerName || sale.customerId]] : [])
  ],
  items:(sale.items || []).map(item=>({
    name:item.productName || item.sku || 'Item', quantity:Number(item.quantity || 0),
    unitPriceCents:item.unitPriceCents, totalCents:item.totalCents
  })),
  totals:[['Subtotal',sale.subtotalCents], ...(Number(sale.discountCents||0)>0 ? [['Desconto',-Number(sale.discountCents)]] : []), ['TOTAL',sale.totalCents]],
  payments:(sale.payments || []).map(payment=>[payment.method || 'Pagamento', payment.amountCents]),
  changeCents:Number(sale.changeCents || 0),
  footer:['Obrigado pela preferencia']
});
return renderPlainText(document);
```

Preserve exported `money`, `fit`, `center`, `columns` aliases to avoid breaking `non-fiscal-renderer.js` or other consumers during the same commit.

- [ ] **Step 4: Point non-fiscal formatting primitives directly at the shared module**

Change:

```js
const { money, fit, center, columns } = require('@artisys/printing');
```

Keep restaurant-specific labels and order/session mapping in the PDV.

- [ ] **Step 5: Run rendering regressions**

Run: `node --test test/artisys-print-renderers.test.js && npm test`

Expected: same business output for existing sale, pre-bill, kitchen ticket and cash-close tests.

- [ ] **Step 6: Commit**

```bash
git add js/domains/printing/receipt-renderer.js js/domains/printing/non-fiscal-renderer.js test/artisys-print-renderers.test.js
git commit -m "refactor: use artisys printing primitives"
```

---

### Task 5: Configuration, diagnostics and operator-safe status

**Files:**
- Modify: `README.md`
- Create: `docs/operations/hardware-printing.md`
- Modify: `desktop/hardware-runtime.cjs`
- Modify: `test/hardware-runtime.test.js`

**Interfaces:**
- Consumes: resolved runtime configuration.
- Produces: clear hardware status and documented local configuration.

- [ ] **Step 1: Add status contract tests**

Assert status includes only operational metadata, never secrets/raw buffers:

```js
const status=await runtime.status();
assert.equal(status.printer.mode, 'electron');
assert.equal(status.barcodeScanner.mode, 'keyboard-wedge');
assert.equal('requestCommand' in status.scale, false);
```

- [ ] **Step 2: Add explicit optional environment variables**

Document:

```text
PDV_PRINTER_MODE=electron|thermal|serial
PDV_PRINTER_TYPE=epson|star|generic
PDV_PRINTER_INTERFACE=printer:EPSON
PDV_PRINTER_PORT=COM5
PDV_PRINTER_NAME=EPSON TM-T20X
PDV_PRINTER_CUT=true|false
PDV_PRINT_SILENT=true|false
PDV_RECEIPT_WIDTH=32|42|48
PDV_SCALE_PORT=COM3
PDV_SCALE_BAUD=9600
PDV_SCALE_COMMAND=
PDV_DRAWER_PORT=COM4
PDV_DRAWER_BAUD=9600
```

State explicitly that barcode scanners in keyboard-wedge mode need no SerialPort configuration.

- [ ] **Step 3: Document device profiles and failure behavior**

`docs/operations/hardware-printing.md` must explain:

- Electron mode is default and preserves current installations.
- Thermal/serial mode is opt-in per installation.
- Printer protocol/model compatibility must be validated physically.
- Failed configured prints remain `FAILED`; the system does not silently redirect the same job to another printer.
- Scale/drawer absent configuration reports unavailable instead of preventing app startup.

- [ ] **Step 4: Run tests**

Run: `node --test test/hardware-runtime.test.js && npm run verify`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/operations/hardware-printing.md desktop/hardware-runtime.cjs test/hardware-runtime.test.js
git commit -m "docs: add pdv hardware configuration"
```

---

### Task 6: Release/build verification

**Files:**
- Modify if needed: `.github/workflows/verify.yml`
- Modify if needed: `.github/workflows/release-windows.yml`
- Modify if needed: `scripts/run-release-tests.js`

**Interfaces:**
- Consumes: completed module integration.
- Produces: verified Electron build that contains the local ArtiSys packages and native SerialPort bindings.

- [ ] **Step 1: Add release assertions before changing workflow**

Extend release tests to check:

```js
assert.ok(require.resolve('@artisys/serialport'));
assert.ok(require.resolve('@artisys/printing'));
assert.ok(require.resolve('serialport'));
```

Also inspect the electron-builder config programmatically and assert `asarUnpack` contains both `node_modules/serialport/**/*` and `node_modules/@serialport/**/*`.

- [ ] **Step 2: Run release verification locally**

Run: `npm run verify:release`

Expected: PASS before packaging.

- [ ] **Step 3: Build Windows installer**

Run: `npm run dist:win`

Expected: `dist/ArtiSys-PDV-<version>-x64-Setup.exe` is produced and electron-builder successfully rebuilds SerialPort native bindings for the Electron target.

- [ ] **Step 4: Smoke-test packaged hardware status without physical devices**

Launch with no hardware variables set. Expected status:

```js
{
  barcodeScanner:{ available:true, mode:'keyboard-wedge' },
  scale:{ available:false, reason:'not-configured' },
  printer:{ available:true, mode:'electron', ... },
  cashDrawer:{ available:false, reason:'not-configured' }
}
```

A real scale/printer/drawer physical validation is a separate release-acceptance step and is required before promoting the reusable modules from `implemented` to `stable`.

- [ ] **Step 5: Run final complete verification**

Run:

```bash
npm ci
npm run verify:release
npm run dist:win
```

Expected: all tests/lints/release checks pass and Windows installer builds.

- [ ] **Step 6: Commit any workflow/release-test changes**

```bash
git add .github/workflows scripts package.json package-lock.json
git commit -m "test: verify artisys hardware packaging"
```
