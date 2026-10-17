const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('catalog search shim is retired and canonical renderer owns stable incremental search',()=>{
  const app=read('desktop/renderer/app.js');
  const index=read('desktop/renderer/index.html');
  assert.equal(fs.existsSync(path.join(root,'desktop/renderer/catalog-search-stability.js')),false);
  assert.doesNotMatch(index,/catalog-search-stability\.js/);
  assert.match(app,/function renderProductsList\(\)/);
  assert.match(app,/function renderCustomersList\(\)/);
  assert.match(app,/product-page-search'[\s\S]*renderProductsList\(\)/);
  assert.match(app,/customer-page-search'[\s\S]*renderCustomersList\(\)/);
});


test('product photo sync status does not rebuild the Products page or replace the focused search input',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/function productPhotoSyncLabel\(\)/);
  assert.match(app,/function updateProductPhotoSyncStatus\(\)[\s\S]*querySelector\('\[data-products-canonical="true"\] \.toolbar small'\)[\s\S]*label\.textContent=productPhotoSyncLabel\(\)/);
  const monitorStart=app.indexOf('function monitorProductPhotoSync()');
  const syncStart=app.indexOf('async function syncProductPhotos',monitorStart);
  const uploadStart=app.indexOf('async function uploadProductPhoto',syncStart);
  assert.notEqual(monitorStart,-1);
  assert.notEqual(syncStart,-1);
  assert.notEqual(uploadStart,-1);
  const monitor=app.slice(monitorStart,syncStart);
  const sync=app.slice(syncStart,uploadStart);
  assert.match(monitor,/updateProductPhotoSyncStatus\(\)/);
  assert.doesNotMatch(monitor,/renderProducts\(\)/);
  assert.match(sync,/updateProductPhotoSyncStatus\(\)/);
  assert.doesNotMatch(sync,/renderProducts\(\)/);
});

test('compact cart uses a two-column resilient grid instead of the legacy three-column squeeze',()=>{
  const css=read('desktop/renderer/regression-hardening.css');
  assert.match(css,/\.cart-line\s*\{[\s\S]*grid-template-columns:minmax\(0,1fr\) auto !important/);
  assert.match(css,/overflow-wrap:anywhere/);
});

test('returns desktop UI connects completed sales and refunds to real APIs',()=>{
  const source=read('desktop/renderer/returns-ui.js');
  assert.match(source,/api\.salesHistory\(\{status:'COMPLETED'/);
  assert.match(source,/api\.createReturn\(payload\)/);
  assert.match(source,/api\.authorizeReturn\(\{/);
});
