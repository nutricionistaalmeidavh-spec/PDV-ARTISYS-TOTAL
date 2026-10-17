'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createPublicOrderingService}=require('../js/domains/restaurant/public-ordering');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};
const system={kind:'system',id:'system'};
const read=relative=>fs.readFileSync(path.join(__dirname,'..',relative),'utf8');

function orderingFor(runtime){
  return createPublicOrderingService({
    db:runtime.db,
    modules:runtime.modules,
    catalog:runtime.catalog,
    catalogCustomization:runtime.catalogCustomization,
    restaurant:runtime.restaurant,
    productPhotos:runtime.productPhotos,
    tokenFactory:()=> 'menu-layout-public-token-0001'
  });
}

test('public menu appearance migrates legacy config to COMPACT and persists only known layouts',()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    runtime.modules.setEnabled('FOOD',true,system);
    runtime.db.exec(`
      CREATE TABLE IF NOT EXISTS restaurant_public_ordering_config (
        id TEXT PRIMARY KEY,
        auto_open_table INTEGER NOT NULL DEFAULT 1 CHECK(auto_open_table IN(0,1)),
        updated_at TEXT NOT NULL
      );
    `);
    runtime.db.prepare("INSERT OR REPLACE INTO restaurant_public_ordering_config(id,auto_open_table,updated_at) VALUES('default',0,?)").run('legacy');

    const ordering=orderingFor(runtime);
    assert.equal(ordering.getConfig().menuLayout,'COMPACT');
    assert.equal(ordering.getConfig().autoOpenTable,false);

    const premium=ordering.updateConfig({menuLayout:'PREMIUM'},admin);
    assert.equal(premium.menuLayout,'PREMIUM');
    assert.equal(premium.autoOpenTable,false);
    assert.throws(()=>ordering.updateConfig({menuLayout:'NEON'},admin),/aparência|layout/i);
    assert.equal(ordering.getConfig().menuLayout,'PREMIUM');
  }finally{runtime.close();}
});

test('public menu context exposes the canonical menu layout without changing ordering ownership',()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    runtime.modules.setEnabled('FOOD',true,system);
    runtime.catalog.upsertCategory({id:'food',name:'Lanches'},admin);
    runtime.catalog.upsertProduct({id:'burger',name:'Burger',categoryId:'food',salePriceCents:2490,costCents:900,trackStock:false,menuEnabled:true},admin);
    runtime.restaurant.upsertTable({id:'table-1',label:'Mesa 1',seats:4},admin);
    const ordering=orderingFor(runtime);
    const access=ordering.issueTableAccess('table-1',admin);
    ordering.updateConfig({menuLayout:'COMPACT'},admin);

    const context=ordering.publicContext(access.token);
    assert.equal(context.config.menuLayout,'COMPACT');
    assert.equal(context.products[0].id,'burger');
    assert.equal(typeof ordering.submitOrder,'function');
  }finally{runtime.close();}
});

test('desktop selector and customer menu keep one canonical renderer for compact and premium layouts',()=>{
  const desktop=read('desktop/renderer/restaurant-public-ordering-ui.js');
  const desktopCss=read('desktop/renderer/restaurant-public-ordering-ui.css');
  const menu=read('server/customer-menu/app.js');
  const menuCss=read('server/customer-menu/styles.css');

  assert.match(desktop,/Aparência do cardápio/);
  assert.match(desktop,/Moderno e compacto/);
  assert.match(desktop,/Visual gastronômico/);
  assert.match(desktop,/name="menuLayout"/);
  assert.match(desktop,/layoutOption\(\{value:'COMPACT'/);
  assert.match(desktop,/layoutOption\(\{value:'PREMIUM'/);
  assert.doesNotMatch(desktop,/layoutOption\(\{value:'PREMIUM'[^)]*disabled:true/);
  assert.match(desktop,/menuLayout:/);
  assert.match(desktopCss,/\.menu-layout-selector/);
  assert.match(desktopCss,/\.menu-layout-preview/);
  assert.ok(desktop.includes('menu-layout-preview-product'));
  assert.ok(desktop.includes('item.salePriceCents'));
  assert.ok(desktop.includes('model.menu.filter'));
  assert.ok(desktopCss.includes('input:focus-visible'));

  assert.match(menu,/applyMenuLayout\(context\.config\?\.menuLayout\)/);
  assert.match(menu,/requested==='PREMIUM'\?'premium':'compact'/);
  assert.match(menu,/product-card \$\{product\.photo\?'has-photo':'no-photo'\}/);
  assert.match(menuCss,/\[data-menu-layout="compact"\] \.product-card\.has-photo/);
  assert.match(menuCss,/\[data-menu-layout="compact"\] \.product-card\.no-photo/);
  assert.match(menuCss,/\[data-menu-layout="compact"\] \.photo-placeholder/);
  assert.match(menuCss,/\[data-menu-layout="premium"\] \.product-card\.has-photo/);
  assert.match(menuCss,/\[data-menu-layout="premium"\] \.product-card\.no-photo/);
  assert.match(menuCss,/\[data-menu-layout="premium"\] \.photo-placeholder/);
  assert.match(menuCss,/\[data-menu-layout="premium"\] \.product-photo/);
  assert.match(menuCss,/@media\(max-width:760px\)[\s\S]*\[data-menu-layout="premium"\]/);

  for(const source of [desktop,menu]){
    assert.doesNotMatch(source,/MutationObserver/);
    assert.doesNotMatch(source,/renderPremium|mountPremium|compact-ordering-service/i);
  }
});


test('QA captures the premium public menu and checks its accessibility floor',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const steps=flow.steps||[];
  const premiumConfig=steps.find(step=>step.action==='desktopApiRequest'&&step.path==='/api/v1/restaurant/public-ordering/config'&&step.body?.menuLayout==='PREMIUM');
  assert.ok(premiumConfig,'QA must publish PREMIUM before the premium capture');
  const premiumIndex=steps.indexOf(premiumConfig);
  const firstExternalNavigation=steps.findIndex(step=>step.action==='goto'&&(step.path==='/mobile'||step.name==='abrir-cardapio-qr'));
  assert.ok(premiumIndex>=0&&premiumIndex<firstExternalNavigation,'PREMIUM must be persisted while the Electron API bridge is still available');
  assert.equal(steps.some(step=>step.action==='expectVisible'&&step.selector==='html[data-menu-layout="premium"]'),true);
  assert.equal(steps.some(step=>step.action==='focus'&&step.selector==='.add-button'),true);
  assert.equal(steps.some(step=>step.action==='expectFocused'&&step.selector==='.add-button'),true);
  assert.equal(steps.some(step=>step.action==='expectMinimumContrast'&&step.selector==='.product-price'&&Number(step.minRatio)>=4.5),true);
  assert.equal(steps.some(step=>step.action==='screenshot'&&step.name==='cardapio-qr-premium'),true);
  assert.equal(steps.some(step=>step.action==='expectNoHorizontalOverflow'&&step.name==='cardapio-qr-premium-sem-overflow'),true);
});

test('public menu visual v2 stays canonical while matching the compact and premium composition',()=>{
  const html=read('server/customer-menu/index.html');
  const menu=read('server/customer-menu/app.js');
  const css=read('server/customer-menu/styles.css');

  for(const marker of [
    'id="menu-hero-photo"',
    'id="featured-products"',
    'id="products-title"',
    'id="mobile-menu-nav"'
  ]) assert.ok(html.includes(marker),`missing visual-v2 markup: ${marker}`);

  for(const marker of [
    'function renderHero()',
    'function renderFeatured()',
    'category-media',
    'featured-card',
    'product-dialog-media',
    "data-menu-nav='catalog'",
    "data-menu-nav='order'",
    "data-menu-nav='waiter'"
  ]) assert.ok(menu.includes(marker),`missing visual-v2 behavior: ${marker}`);

  for(const selector of [
    '[data-menu-layout="compact"] .menu-hero',
    '[data-menu-layout="compact"] .featured-card',
    '[data-menu-layout="compact"] .add-button-icon',
    '[data-menu-layout="premium"] .menu-hero',
    '[data-menu-layout="premium"] .category-media',
    '[data-menu-layout="premium"] .featured-card',
    '[data-menu-layout="premium"] .mobile-menu-nav',
    '[data-menu-layout="premium"] .product-dialog-media'
  ]) assert.ok(css.includes(selector),`missing visual-v2 selector: ${selector}`);

  assert.doesNotMatch(menu,/MutationObserver/);
  assert.doesNotMatch(menu,/renderPremium|mountPremium|premium-ordering-service|compact-ordering-service/i);
});
