'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
function read(rel){return fs.readFileSync(path.join(root,rel),'utf8');}

test('post-sale UI exposes independent print and PDF actions side by side',()=>{
  const ui=read('desktop/renderer/post-sale-receipt-ui.js');
  const css=read('desktop/renderer/post-sale-receipt-ui.css');
  const html=read('desktop/renderer/index.html');
  assert.match(ui,/post-sale-print/);
  assert.match(ui,/post-sale-save-pdf/);
  assert.match(ui,/receipts\.printSale/);
  assert.match(ui,/receipts\.saveSalePdf/);
  assert.match(css,/grid-template-columns\s*:\s*repeat\(2/);
  assert.match(html,/post-sale-receipt-ui\.css/);
  assert.match(html,/post-sale-receipt-ui\.js/);
});

test('printing settings UI covers printer, 58\/80 mm and persisted options',()=>{
  const ui=read('desktop/renderer/post-sale-receipt-ui.js');
  assert.match(ui,/\/api\/v1\/printing\/preferences/);
  assert.match(ui,/printing-device-name/);
  assert.match(ui,/printing-paper-mm/);
  assert.match(ui,/value="58"/);
  assert.match(ui,/value="80"/);
  assert.match(ui,/printing-columns-mode/);
  assert.match(ui,/printing-auto-print/);
  assert.match(ui,/hardware\.listPrinters/);
  assert.match(ui,/hardware\.testPrinter/);
  assert.match(ui,/PdvUiLifecycle/);
  assert.match(ui,/route:updated/);
  assert.doesNotMatch(ui,/MutationObserver/);
});
