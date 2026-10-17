const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('../server/local-server');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-ui-api-'));
  let seq = 0;
  const runtime = createPdvRuntime({
    dbPath: path.join(dir, 'pdv.sqlite'),
    idFactory: (prefix) => `${prefix}-${++seq}`
  });
  const server = createLocalServer({ runtime, host: '127.0.0.1', port: 0, token: 'installation-secret' });
  const address = await server.start();
  const base = `http://${address.host}:${address.port}`;
  return {
    runtime,
    server,
    base,
    async cleanup() {
      await server.stop();
      runtime.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function json(res) {
  const body = await res.json();
  assert.ok(body !== undefined);
  return body;
}

function headers(token) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function bootstrapAndLogin(ctx) {
  let res = await fetch(`${ctx.base}/api/v1/setup/status`);
  assert.equal(res.status, 200);
  assert.equal((await json(res)).needsSetup, true);

  res = await fetch(`${ctx.base}/api/v1/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pdv-token': 'installation-secret' },
    body: JSON.stringify({ username: 'admin', name: 'Administrador', password: 'senha-forte-123' })
  });
  assert.equal(res.status, 201);

  res = await fetch(`${ctx.base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pdv-token': 'installation-secret' },
    body: JSON.stringify({ username: 'admin', password: 'senha-forte-123', terminalId: 'PDV-01' })
  });
  assert.equal(res.status, 200);
  const login = await json(res);
  assert.equal(login.user.profileId, 'profile-administrator');
  assert.equal(login.user.profile?.systemKey, 'admin');
  return login.sessionToken;
}

test('first-run setup creates the only initial admin and closes setup afterwards', async () => {
  const ctx = await setup();
  try {
    await bootstrapAndLogin(ctx);
    let res = await fetch(`${ctx.base}/api/v1/setup/status`);
    assert.equal((await json(res)).needsSetup, false);
    res = await fetch(`${ctx.base}/api/v1/setup/admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pdv-token': 'installation-secret' },
      body: JSON.stringify({ username: 'other', name: 'Outro', password: 'senha-forte-456' })
    });
    assert.equal(res.status, 409);
  } finally {
    await ctx.cleanup();
  }
});

test('catalog endpoints support categories customers sellers and stock-aware products', async () => {
  const ctx = await setup();
  try {
    const token = await bootstrapAndLogin(ctx);
    let res = await fetch(`${ctx.base}/api/v1/categories`, {
      method: 'POST', headers: headers(token), body: JSON.stringify({ id: 'cat-beb', name: 'Bebidas' })
    });
    assert.equal(res.status, 201);
    res = await fetch(`${ctx.base}/api/v1/categories`, { headers: headers(token) });
    assert.deepEqual((await json(res)).map((x) => x.name), ['Bebidas']);

    res = await fetch(`${ctx.base}/api/v1/customers`, {
      method: 'POST', headers: headers(token), body: JSON.stringify({ id: 'c1', name: 'José da Silva', document: '123.456.789-00', creditLimitCents: 50000 })
    });
    assert.equal(res.status, 201);
    res = await fetch(`${ctx.base}/api/v1/customers`, { headers: headers(token) });
    assert.equal((await json(res))[0].document, '12345678900');

    res = await fetch(`${ctx.base}/api/v1/users`, {
      method: 'POST', headers: headers(token), body: JSON.stringify({ id: 'seller1', username: 'maria', name: 'Maria Silva', profileId:'profile-cashier', password: 'senha-vendedor-123' })
    });
    assert.equal(res.status, 201);
    res = await fetch(`${ctx.base}/api/v1/users`, { headers: headers(token) });
    assert.ok((await json(res)).some((user) => user.name === 'Maria Silva'));

    res = await fetch(`${ctx.base}/api/v1/products`, {
      method: 'POST', headers: headers(token), body: JSON.stringify({ id: 'p1', sku: '000001', barcode: '7891', name: 'Água Mineral 500ml', categoryId: 'cat-beb', salePriceCents: 250, costCents: 120, minimumStock: 2 })
    });
    assert.equal(res.status, 201);
    res = await fetch(`${ctx.base}/api/v1/inventory/movements`, {
      method: 'POST', headers: headers(token), body: JSON.stringify({ productId: 'p1', type: 'opening', quantityDelta: 10 })
    });
    assert.equal(res.status, 201);
    res = await fetch(`${ctx.base}/api/v1/products`, { headers: headers(token) });
    const product = (await json(res))[0];
    assert.equal(product.stockQuantity, 10);
    assert.equal(product.categoryName, 'Bebidas');
    res = await fetch(`${ctx.base}/api/v1/commission-rules`, { method:'POST',headers:headers(token),body:JSON.stringify({sellerId:'seller1',productId:'p1',commissionBps:500}) });
    assert.equal(res.status,201);
    assert.equal((await json(res)).commissionBps,500);
    res = await fetch(`${ctx.base}/api/v1/product-photos/p1`, { method:'POST',headers:headers(token),body:JSON.stringify({mimeType:'image/png',originalBase64:PNG_1PX.toString('base64'),thumbnailBase64:PNG_1PX.toString('base64')}) });
    assert.equal(res.status,201);
    const photo=await json(res);assert.equal(photo.productId,'p1');
    res = await fetch(`${ctx.base}/api/v1/product-photos/manifest`, {headers:headers(token)});
    assert.equal((await json(res))[0].thumbnailSha256,photo.thumbnailSha256);
    res = await fetch(`${ctx.base}/api/v1/product-photos/p1/thumbnail`, {headers:headers(token)});
    assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),PNG_1PX);
  } finally {
    await ctx.cleanup();
  }
});

test('checkout API supports customer assignment quantity discount suspend resume remove and open-sale cancellation', async () => {
  const ctx = await setup();
  try {
    const token = await bootstrapAndLogin(ctx);
    let res = await fetch(`${ctx.base}/api/v1/customers`, { method: 'POST', headers: headers(token), body: JSON.stringify({ id: 'c1', name: 'Cliente 1' }) });
    assert.equal(res.status, 201);
    res = await fetch(`${ctx.base}/api/v1/products`, { method: 'POST', headers: headers(token), body: JSON.stringify({ id: 'p1', sku: '1', name: 'Produto', salePriceCents: 1000 }) });
    assert.equal(res.status, 201);
    res = await fetch(`${ctx.base}/api/v1/users`, { method: 'POST', headers: headers(token), body: JSON.stringify({ id: 'seller1', username: 'vendedor', name: 'Vendedor 1', profileId:'profile-cashier', password: 'senha-vendedor-123' }) });
    assert.equal(res.status, 201);
    res = await fetch(`${ctx.base}/api/v1/sellers`, { headers: headers(token) });
    assert.ok((await json(res)).some((seller) => seller.id === 'seller1'));
    res = await fetch(`${ctx.base}/api/v1/sales`, { method: 'POST', headers: headers(token), body: JSON.stringify({ id: 's1', saleNumber: '000001', terminalId: 'PDV-01', sellerId: 'seller1' }) });
    assert.equal(res.status, 201);
    assert.equal((await json(res)).sellerName, 'Vendedor 1');

    res = await fetch(`${ctx.base}/api/v1/sales/s1/customer`, { method: 'POST', headers: headers(token), body: JSON.stringify({ customerId: 'c1' }) });
    assert.equal((await json(res)).customerId, 'c1');

    res = await fetch(`${ctx.base}/api/v1/sales/s1/items`, { method: 'POST', headers: headers(token), body: JSON.stringify({ productId: 'p1', quantity: 1 }) });
    assert.equal((await json(res)).items[0].quantity, 1);
    res = await fetch(`${ctx.base}/api/v1/sales/s1/items/p1`, { method: 'PUT', headers: headers(token), body: JSON.stringify({ quantity: 3 }) });
    const changedQuantity = await json(res);
    assert.equal(changedQuantity.items[0].quantity, 3);
    res = await fetch(`${ctx.base}/api/v1/sales/s1/items/${changedQuantity.items[0].id}/price`, { method: 'PUT', headers: headers(token), body: JSON.stringify({ unitPriceCents: 800, reason: 'Oferta autorizada' }) });
    const repriced = await json(res);
    assert.equal(repriced.items[0].catalogUnitPriceCents, 1000);
    assert.equal(repriced.items[0].unitPriceCents, 800);

    res = await fetch(`${ctx.base}/api/v1/sales/s1/discount`, { method: 'POST', headers: headers(token), body: JSON.stringify({ discountCents: 500 }) });
    assert.equal((await json(res)).totalCents, 1900);

    res = await fetch(`${ctx.base}/api/v1/sales/s1/suspend`, { method: 'POST', headers: headers(token), body: '{}' });
    assert.equal((await json(res)).status, 'SUSPENDED');
    res = await fetch(`${ctx.base}/api/v1/sales?status=SUSPENDED`, { headers: headers(token) });
    assert.equal((await json(res))[0].id, 's1');
    res = await fetch(`${ctx.base}/api/v1/sales/s1/resume`, { method: 'POST', headers: headers(token), body: '{}' });
    assert.equal((await json(res)).status, 'OPEN');

    res = await fetch(`${ctx.base}/api/v1/sales/s1/items/p1`, { method: 'DELETE', headers: headers(token) });
    assert.equal((await json(res)).items.length, 0);
    res = await fetch(`${ctx.base}/api/v1/sales/s1/cancel`, { method: 'POST', headers: headers(token), body: JSON.stringify({ reason: 'Cliente desistiu' }) });
    const cancelled = await json(res);
    assert.equal(cancelled.sale.status, 'CANCELLED');
    assert.equal(cancelled.dispatch.attempted, 1);
    assert.equal(cancelled.dispatch.failures.length, 0);
  } finally {
    await ctx.cleanup();
  }
});
