'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('simple extensions consume semantic lifecycle without MutationObserver',()=>{
  const files=[
    'desktop/renderer/catalog-user-management-ui.js',
    'desktop/renderer/delivery-address-ui.js',
    'desktop/renderer/kits-combos-ui.js',
    'desktop/renderer/module-state-sync.js',
    'desktop/renderer/operational-friendly-fields.js'
  ];
  for(const file of files){
    const source=read(file);
    assert.match(source,/PdvUiLifecycle/,file);
    assert.doesNotMatch(source,/new\s+MutationObserver\b/,file);
  }
});

test('shared modal and enterprise subflows publish semantic triggers',()=>{
  const app=read('desktop/renderer/app.js');
  const enterprise=read('desktop/renderer/enterprise-depth-ui.js');
  const vertical=read('desktop/renderer/vertical-modules.js');
  assert.match(app,/emit\('modal:mounted'/);
  assert.match(app,/emit\('modal:closed'/);
  for(const surface of ['enterprise-purchases','enterprise-logistics','enterprise-orders']){
    assert.ok(enterprise.includes(`surface:'${surface}'`),surface);
  }
  assert.match(vertical,/routeRegistry\.register\('FOOD',\{owner:'vertical-modules'/);
  assert.match(vertical,/routeRegistry\.register\('WHOLESALE',\{owner:'vertical-modules'/);
  assert.match(vertical,/emit\('surface:mounted'/);
  assert.doesNotMatch(vertical,/surface:'module-workspace'|surface:'module-area'/);
});

test('operational friendly fields listen to route modal and module surfaces',()=>{
  const source=read('desktop/renderer/operational-friendly-fields.js');
  for(const marker of ['route:mounted','route:updated','surface:mounted','modal:mounted']) assert.ok(source.includes(marker),marker);
});

test('catalog customer actions survive incremental list rebuilds',()=>{
  const source=read('desktop/renderer/catalog-user-management-ui.js');
  assert.match(source,/data-remove-customer/);
  assert.doesNotMatch(source,/if\(root\.dataset\.catalogDeletionEnhanced==='1'\)return/);
  assert.match(source,/route==='customers'&&surface==='customers-list'\)scheduleMount\(\)/);
  assert.match(source,/root\.querySelectorAll\('\[data-edit-customer\]'\)\.forEach/);
  assert.match(source,/let remountRequested=false/);
  assert.match(source,/if\(mounting\)\{remountRequested=true;return;\}/);
  assert.match(source,/if\(remountRequested\)\{remountRequested=false;scheduleMount\(\);\}/);
});

test('complex migrated extensions are owner-invoked rather than DOM-observed',()=>{
  const files=[
    'desktop/renderer/operational-route-extensions.js',
    'desktop/renderer/operational-detail-extensions.js',
    'desktop/renderer/enterprise-depth-ui.js',
    'desktop/renderer/restaurant-public-ordering-ui.js',
    'desktop/renderer/e48-e54-ui.js',
    'desktop/renderer/vertical-modules.js',
    'desktop/renderer/vertical-parity-p1.js'
  ];
  for(const file of files)assert.doesNotMatch(read(file),/new\s+MutationObserver\b/,file);

  const routeExtensions=read('desktop/renderer/operational-route-extensions.js');
  const detailExtensions=read('desktop/renderer/operational-detail-extensions.js');
  const operational=read('desktop/renderer/operational-pages.js');
  const returnsUi=read('desktop/renderer/returns-ui.js');
  const enterprise=read('desktop/renderer/enterprise-depth-ui.js');
  const publicOrdering=read('desktop/renderer/restaurant-public-ordering-ui.js');
  const restaurant=read('desktop/renderer/restaurant-ui.js');

  assert.doesNotMatch(routeExtensions,/MutationObserver|lifecycle\?*\.on\(['"]route:/);
  assert.doesNotMatch(detailExtensions,/MutationObserver|lifecycle\?*\.on\(['"]route:/);
  assert.match(operational,/PdvOperationalRouteExtensions\?\.mountRoute\?\.\(route,pageRoot\)/);
  assert.match(operational,/PdvEnterpriseDepthUi\?\.mountInventory\?\.\(pageRoot\)/);
  assert.match(operational,/PdvOperationalDetailExtensions\?\.mountSettings\?\.\(pageRoot\)/);
  assert.match(returnsUi,/PdvOperationalRouteExtensions\?\.mountReturns\?\.\(page\)/);
  assert.match(returnsUi,/PdvOperationalDetailExtensions\?\.mountReturns\?\.\(page\)/);
  assert.match(enterprise,/PdvOperationalDetailExtensions\?\.mountPurchases\?\.\(page\)/);
  assert.match(enterprise,/PdvOperationalRouteExtensions\?\.mountLogistics\?\.\(page\)/);
  assert.match(enterprise,/PdvOperationalDetailExtensions\?\.mountOrders\?\.\(page\)/);
  assert.match(publicOrdering,/PdvRestaurantPublicOrderingUi=Object\.freeze\(\{mount\}\)/);
  assert.match(restaurant,/PdvRestaurantPublicOrderingUi\?\.mount\?\.\(\)/);
});
