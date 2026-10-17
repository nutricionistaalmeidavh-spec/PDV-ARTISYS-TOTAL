'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');
const {createPublicOrderingService}=require('../js/domains/restaurant/public-ordering');

const admin={userId:'qa-admin',profileId:'profile-administrator',terminalId:'PDV-01'};
const system={kind:'system',id:'system'};

test('QA gate serves staff mobile and public QR menu from the real local server',async t=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  runtime.modules.setEnabled('FOOD',true,system);
  runtime.catalog.upsertCategory({id:'qa-food',name:'QA'},admin);
  runtime.catalog.upsertProduct({
    id:'qa-product',
    name:'Produto QA',
    categoryId:'qa-food',
    salePriceCents:1290,
    costCents:500,
    trackStock:false,
    menuEnabled:true
  },admin);
  runtime.restaurant.upsertTable({id:'qa-table',label:'Mesa QA',seats:4},admin);
  runtime.publicOrdering=createPublicOrderingService({
    db:runtime.db,
    modules:runtime.modules,
    catalog:runtime.catalog,
    catalogCustomization:runtime.catalogCustomization,
    restaurant:runtime.restaurant,
    productPhotos:runtime.productPhotos,
    tokenFactory:()=> 'qa-public-token-00000001'
  });
  const access=runtime.publicOrdering.issueTableAccess('qa-table',admin);
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'qa-local-token',requireTerminalAuth:false});
  t.after(async()=>{await server.stop().catch(()=>{});runtime.close();});

  const address=await server.start();
  const base=`http://${address.host}:${address.port}`;

  const mobile=await fetch(`${base}/mobile`);
  assert.equal(mobile.status,200);
  const mobileHtml=await mobile.text();
  assert.match(mobileHtml,/ArtiSys Restaurante/);
  assert.match(mobileHtml,/\/mobile\/styles\.css/);

  const mobileCss=await fetch(`${base}/mobile/styles.css`);
  assert.equal(mobileCss.status,200);
  assert.match(await mobileCss.text(),/\.btn\{min-height:44px/);

  const menu=await fetch(`${base}/m/${access.token}`);
  assert.equal(menu.status,200);
  const menuHtml=await menu.text();
  assert.match(menuHtml,/Cardápio da mesa/);
  assert.match(menuHtml,/\/menu\/styles\.css/);

  const menuCss=await fetch(`${base}/menu/styles.css`);
  assert.equal(menuCss.status,200);
  assert.match(await menuCss.text(),/\.add-button\{min-width:44px;min-height:44px/);

  const context=await fetch(`${base}/api/v1/public/menu/${access.token}`);
  assert.equal(context.status,200);
  const payload=await context.json();
  assert.equal(payload.table.label,'Mesa QA');
  assert.equal(payload.products.some(product=>product.id==='qa-product'),true);
});
