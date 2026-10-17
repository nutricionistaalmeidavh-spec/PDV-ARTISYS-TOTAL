'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const products = require(path.join(root, 'desktop', 'renderer', 'products-dense-view.js'));
const customers = require(path.join(root, 'desktop', 'renderer', 'customers-master-detail-view.js'));

test('Products and Customers remain at the same guarded UX maturity level', () => {
  assert.equal(products.PRODUCTS_UX_LEVEL, customers.CUSTOMERS_UX_LEVEL);
  assert.equal(products.PRODUCTS_UX_LEVEL, 4);
  assert.deepEqual(products.PRODUCTS_UX_GUARDS, customers.CUSTOMERS_UX_GUARDS);
  assert.equal(products.PRODUCTS_UX_GUARDS.canonicalRenderer, true);
  assert.equal(products.PRODUCTS_UX_GUARDS.lifecycleOwned, true);
  assert.equal(products.PRODUCTS_UX_GUARDS.legacyFallbackRemoved, true);
});

test('paired screens use canonical lifecycle-owned presentation without reversible legacy flags', () => {
  const productController=read('desktop/renderer/products-dense-controller.js');
  const customerController=read('desktop/renderer/customers-master-detail-controller.js');
  for(const [label,source] of [['Produtos',productController],['Clientes',customerController]]) {
    for(const marker of ['PdvUiLifecycle','route:mounted','route:updated','scheduleDecorate',"event.key.toLowerCase() !== 'k'"]) assert.ok(source.includes(marker),`${label}: canonical lifecycle marker missing: ${marker}`);
    assert.doesNotMatch(source,/MutationObserver|PdvFeatureFlags|restoreLegacy/);
  }
});

test('paired screens are both loaded, parity-documented and regression-tested', () => {
  const index=read('desktop/renderer/index.html');
  for(const marker of ['./products-dense-view.css','./customers-master-detail.css','./products-dense-view.js','./customers-master-detail-view.js','./products-dense-controller.js','./customers-master-detail-controller.js']) assert.ok(index.includes(marker),`index: paired UX asset missing: ${marker}`);
  assert.doesNotMatch(index,/feature-flags\.js|catalog-search-stability\.js/);
  for(const file of ['docs/architecture/products-dense-parity.md','docs/architecture/customers-master-detail-parity.md','docs/architecture/paired-ux-evolution.md','docs/architecture/ux-products-clients-evidence.json','test/products-dense-view.test.js','test/customers-master-detail-view.test.js','test/products-dense-integration-parity.test.js','test/customers-master-detail-integration-parity.test.js']) assert.equal(fs.existsSync(path.join(root,file)),true,`paired UX artifact missing: ${file}`);
});

function validateEvidenceReference(entity,key,reference){
  assert.equal(typeof reference,'object');
  assert.equal(typeof reference.file,'string');
  const absolute=path.join(root,reference.file);
  assert.equal(fs.existsSync(absolute),true,`${entity}.${key}: evidence file missing: ${reference.file}`);
  const source=fs.readFileSync(absolute,'utf8');
  for(const marker of reference.markers||[]) assert.ok(source.includes(marker),`${entity}.${key}: marker ${JSON.stringify(marker)} missing from ${reference.file}`);
}

test('paired UX evidence manifest resolves symmetrical canonical P2 evidence', () => {
  const manifest=JSON.parse(read('docs/architecture/ux-products-clients-evidence.json'));
  assert.equal(manifest.version,3);
  const expectedKeys=['canonicalRenderer','parityMatrix','unit','controllerIntegration'];
  for(const entity of ['products','customers']) {
    for(const key of expectedKeys){
      const references=manifest[entity][key];
      assert.ok(Array.isArray(references)&&references.length>0,`${entity}.${key}: evidence required`);
      references.forEach(reference=>validateEvidenceReference(entity,key,reference));
    }
    assert.match(manifest[entity].uiFlows,/current UI E2E/i);
  }
  for(const key of expectedKeys) assert.equal(manifest.products[key].length,manifest.customers[key].length,`${key}: paired evidence depth must match`);
});

test('paired evolution policy still requires both levels to move together', () => {
  const policy=read('docs/architecture/paired-ux-evolution.md');
  for(const marker of ['PRODUCTS_UX_LEVEL','CUSTOMERS_UX_LEVEL','mesmo valor','alteração estrutural','CI deve falhar','Produtos','Clientes']) assert.ok(policy.includes(marker));
});
