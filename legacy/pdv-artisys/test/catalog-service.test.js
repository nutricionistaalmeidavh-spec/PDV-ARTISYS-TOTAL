const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runAccessProfileMigrations } = require('../js/core/database/access-profile-migrations');
const { runCanonicalAccessMigrations } = require('../js/core/database/canonical-access-migrations');
const { createCatalogService } = require('../js/domains/catalog/catalog-service');

function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  runAccessProfileMigrations(db);
  runCanonicalAccessMigrations(db);
  return { db, service: createCatalogService({ db, now: () => '2026-09-09T15:00:00Z', idFactory: prefix => `${prefix}-1` }) };
}

test('upsertCategory and upsertProduct persist cents and stock configuration', () => {
  const { db, service } = setup();
  service.upsertCategory({ id:'cat-1', name:'Bebidas' });
  const product = service.upsertProduct({
    id:'prod-1', sku:'001', barcode:'789100000001', name:'Agua', categoryId:'cat-1', unit:'UN',
    salePriceCents:350, costCents:180, trackStock:true, minimumStock:3
  });
  assert.equal(product.salePriceCents, 350);
  assert.equal(product.trackStock, true);
  assert.equal(service.getProduct('prod-1').barcode, '789100000001');
  assert.equal(db.prepare('SELECT quantity FROM inventory_balances WHERE product_id=?').get('prod-1').quantity, 0);
  db.close();
});

test('product SKU and barcode must be unique when informed', () => {
  const { db, service } = setup();
  service.upsertProduct({ id:'p1', sku:'A1', barcode:'789', name:'Produto 1', salePriceCents:100 });
  assert.throws(() => service.upsertProduct({ id:'p2', sku:'A1', barcode:'999', name:'Produto 2', salePriceCents:100 }), /UNIQUE|ja cadastrado/i);
  assert.throws(() => service.upsertProduct({ id:'p3', sku:'A3', barcode:'789', name:'Produto 3', salePriceCents:100 }), /UNIQUE|ja cadastrado/i);
  db.close();
});

test('customer and supplier documents are normalized before persistence', () => {
  const { db, service } = setup();
  const customer = service.upsertCustomer({ id:'c1', name:'Maria', document:'123.456.789-00', phone:'16999999999', creditLimitCents:50000 });
  const supplier = service.upsertSupplier({ id:'s1', name:'Fornecedor', document:'12.345.678/0001-90' });
  assert.equal(customer.document, '12345678900');
  assert.equal(supplier.document, '12345678000190');
  db.close();
});

test('createUser stores a password hash, validates profile and authenticates securely', () => {
  const { db, service } = setup();
  const user = service.createUser({ id:'u1', username:'admin', name:'Administrador', profileId:'profile-administrator', password:'Senha-forte-123' });
  assert.equal(user.profileId, 'profile-administrator');
  const raw = db.prepare('SELECT password_hash AS hash,password_salt AS salt FROM users WHERE id=?').get('u1');
  assert.notEqual(raw.hash, 'Senha-forte-123');
  assert.ok(raw.salt);
  assert.equal(service.verifyUserPassword('admin','Senha-forte-123').ok, true);
  assert.equal(service.verifyUserPassword('admin','errada').ok, false);
  assert.throws(() => service.createUser({ id:'u2', username:'x', name:'X', profileId:'profile-inexistente', password:'1234567890' }), /Perfil de acesso nao encontrado|inativo/);
  const inheritedLegacyRole = Object.assign(Object.create({ role:'manager' }), { id:'u3', username:'inherited', name:'Herdado', profileId:'profile-manager', password:'Senha-forte-123' });
  const inheritedUser = service.createUser(inheritedLegacyRole);
  assert.equal(inheritedUser.profileId, 'profile-manager');
  assert.throws(() => service.createUser({ id:'u4', username:'legacy', name:'Legado', role:'manager', profileId:'profile-manager', password:'Senha-forte-123' }), /Campo role legado/);
  db.close();
});

test('deactivation is soft and listProducts hides inactive by default', () => {
  const { db, service } = setup();
  service.upsertProduct({ id:'p1', sku:'1', name:'Ativo', salePriceCents:100 });
  service.upsertProduct({ id:'p2', sku:'2', name:'Inativo', salePriceCents:100, active:false });
  assert.deepEqual(service.listProducts().map(p => p.id), ['p1']);
  assert.equal(service.listProducts({ includeInactive:true }).length, 2);
  db.close();
});
