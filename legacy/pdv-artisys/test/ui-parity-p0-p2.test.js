'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const rendererPath=path.join(root,'desktop','renderer','operational-detail-extensions.js');

function source(file){return fs.readFileSync(path.join(root,file),'utf8');}

test('operational detail extension is loaded and parses',()=>{
  assert.ok(fs.existsSync(rendererPath),'desktop/renderer/operational-detail-extensions.js must exist');
  const parsed=spawnSync(process.execPath,['--check',rendererPath],{encoding:'utf8'});
  assert.equal(parsed.status,0,`${parsed.stdout||''}\n${parsed.stderr||''}`);
  assert.match(source('desktop/renderer/index.html'),/operational-detail-extensions\.js/);
});

test('P0 exposes partial purchase receiving and partial sales-order fulfillment',()=>{
  const ui=source('desktop/renderer/operational-detail-extensions.js');
  for(const marker of [
    'p0-partial-receipt-panel','data-partial-receive','data-receive-qty','purchaseReceipts',
    'p0-partial-fulfillment-panel','data-partial-fulfill','data-fulfill-qty','fulfillSalesOrder'
  ]) assert.ok(ui.includes(marker),`P0 UI marker missing: ${marker}`);
  assert.match(ui,/quantity\s*>\s*0/);
  assert.match(ui,/pendingQuantity/);
});

test('P1 exposes failed print retry, terminal administration and purchase receipt history',()=>{
  const ui=source('desktop/renderer/operational-detail-extensions.js');
  for(const marker of [
    'p1-print-retry-panel','retryPrint','status:\'FAILED\'',
    'p1-terminal-admin-panel','/api/v1/lan/pairing-codes','/api/v1/terminals',
    'p1-purchase-receipts-panel','purchaseReceipts'
  ]) assert.ok(ui.includes(marker),`P1 UI marker missing: ${marker}`);
});

test('P1 terminal settings extension re-announces its explicit units category',()=>{
  const ui=source('desktop/renderer/operational-detail-extensions.js');
  assert.match(ui,/p1-terminal-admin-panel/);
  assert.match(ui,/settingsCategory\s*=\s*['"]units['"]/);
  assert.match(ui,/route:updated/);
  assert.match(ui,/parity-settings/);
});

test('P2 exposes return details and import batch lookup',()=>{
  const ui=source('desktop/renderer/operational-detail-extensions.js');
  for(const marker of [
    'p2-return-details-panel','returnDetails','data-return-details',
    'p2-import-batch-panel','importBatch','ops-import-batch-lookup'
  ]) assert.ok(ui.includes(marker),`P2 UI marker missing: ${marker}`);
});

test('P0-P2 parity operations remain registered in the capability catalog',()=>{
  const registry=JSON.parse(source('release/customer-operations.json'));
  const ids=new Set(registry.operations.map(item=>item.id));
  for(const id of [
    'procurement.partial-receive','orders.partial-fulfill','printing.failed.retry',
    'lan.pairing-code.create','lan.terminal.status.update','procurement.receipt.list',
    'returns.details.get','imports.batch.get'
  ]) assert.ok(ids.has(id),`operation missing from parity registry: ${id}`);
});
