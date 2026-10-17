const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'desktop/renderer/app.js'),'utf8');
const restaurantRouter=fs.readFileSync(path.join(root,'server/restaurant-router.js'),'utf8');

test('product and recipe forms expose one canonical production destination field in Estoque',()=>{
  assert.match(app,/function productionDestinationMarkup\(/);
  assert.match(app,/Sem KDS — garçom entrega/);
  assert.match(app,/Produção · enviar ao KDS/);
  assert.match(app,/\/api\/v1\/restaurant\/kitchen\/routing/);
  assert.match(app,/\/api\/v1\/restaurant\/kitchen\/stations/);
  assert.ok((app.match(/persistProductionDestination\(root,saved(?:Product)?\.id\)/g)||[]).length>=2,
    'stock product and technical sheet saves must persist the same canonical route');
});

test('a product route can be read before the product is added to Cardapio',()=>{
  assert.ok(restaurantRouter.includes('const productRouting=pathname.match('));
  assert.match(restaurantRouter,/runtime\.kitchen\.getProductRoute/);
});

test('product and recipe validate destination before creating a new catalog record',()=>{
  assert.match(app,/await requireProductionDestination\(root\); const saved=await api\.saveProduct/);
  assert.match(app,/await requireProductionDestination\(root\);savedProduct=await api\.saveProduct/);
});

test('Cardapio only consumes the canonical destination and sends missing configuration to Estoque',()=>{
  assert.match(app,/function ensureMenuProductHasDestination\(/);
  assert.match(app,/function openInventoryConfigurationRequired\(/);
  assert.match(app,/PdvCatalogAdmin\?\.openInventoryItem\?\.\(product\.id\)/);
  assert.doesNotMatch(app,/function openMenuDestinationForm\(/);
  assert.doesNotMatch(app,/data-product-destination-edit/);
});

test('menu list exposes destination read-only and inventory has one deep-link editor',()=>{
  assert.match(app,/productionDestinationLabel\(/);
  assert.match(app,/data-production-destination/);
  assert.match(app,/function openInventoryItem\(productId\)/);
  assert.match(app,/PdvCatalogAdmin = Object\.freeze\(\{[^}]*openInventoryItem/s);
});
