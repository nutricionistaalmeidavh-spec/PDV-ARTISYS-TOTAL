'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('../server/local-server');

const INSTALL_TOKEN = 'returns-test-install-token';
const MANAGER_PASSWORD = 'Manager-local-123!';
const CASHIER_PASSWORD = 'Cashier-local-123!';
const OTHER_CASHIER_PASSWORD = 'Other-cashier-123!';

function managerActor() { return { userId:'manager1', profileId:'profile-manager', terminalId:'PDV-01' }; }

async function createCompletedSale(runtime, { id, saleNumber, quantity = 2 } = {}) {
  const sale = runtime.sales.openSale({ id, saleNumber, terminalId:'PDV-01', operatorId:'manager1' }, managerActor());
  runtime.sales.addItem(sale.id, { productId:'p1', quantity });
  runtime.sales.completeSale(sale.id, { payments:[{ method:'CASH', amountCents:1000 * quantity }], actor:managerActor() });
  const dispatch = await runtime.dispatchPending();
  assert.equal(dispatch.failed, 0);
  return runtime.sales.getSale(sale.id);
}

async function setup() {
  const runtime = createPdvRuntime();
  runtime.catalog.createUser({ id:'manager1', username:'gerente', name:'Gerente QA', profileId:'profile-manager', password:MANAGER_PASSWORD });
  runtime.catalog.createUser({ id:'cashier1', username:'caixa', name:'Caixa QA', profileId:'profile-cashier', password:CASHIER_PASSWORD });
  runtime.catalog.createUser({ id:'cashier2', username:'outrocaixa', name:'Outro Caixa', profileId:'profile-cashier', password:OTHER_CASHIER_PASSWORD });
  runtime.catalog.upsertCategory({ id:'cat1', name:'Geral' });
  runtime.catalog.upsertProduct({ id:'p1', sku:'RET-1', name:'Produto devolucao', salePriceCents:1000, costCents:500, trackStock:false });
  runtime.cash.openSession({ terminalId:'PDV-01', operatorId:'manager1', initialCashCents:0, actor:managerActor() });
  const sale1 = await createCompletedSale(runtime, { id:'sale1', saleNumber:'RET-001', quantity:2 });
  const sale2 = await createCompletedSale(runtime, { id:'sale2', saleNumber:'RET-002', quantity:1 });
  const server = createLocalServer({ runtime, host:'127.0.0.1', port:0, token:INSTALL_TOKEN });
  const address = await server.start();
  return {
    runtime,
    server,
    base:`http://${address.host}:${address.port}`,
    saleItemId:sale1.items[0].id,
    sale2ItemId:sale2.items[0].id,
    async cleanup() { await server.stop(); runtime.close(); }
  };
}

async function login(ctx, username, password) {
  const response = await fetch(`${ctx.base}/api/v1/auth/login`, {
    method:'POST',
    headers:{ 'content-type':'application/json', 'x-pdv-token':INSTALL_TOKEN },
    body:JSON.stringify({ username, password, terminalId:'PDV-01' })
  });
  assert.equal(response.status, 200);
  return (await response.json()).sessionToken;
}

function headers(token, mutationId) {
  const result = { authorization:`Bearer ${token}`, 'content-type':'application/json' };
  if (mutationId) result['x-mutation-id'] = mutationId;
  return result;
}

async function authorize(ctx, token, { username='gerente', password=MANAGER_PASSWORD, saleId='sale1', terminalId='PDV-01' } = {}) {
  return fetch(`${ctx.base}/api/v1/auth/authorize`, {
    method:'POST',
    headers:headers(token),
    body:JSON.stringify({ username, password, scope:'return.complete', resource:{ saleId, terminalId } })
  });
}

function returnBody(saleItemId, approvalToken, saleId='sale1') {
  return {
    saleId,
    reason:'Cliente devolveu uma unidade',
    items:[{ saleItemId, quantity:1 }],
    refunds:[{ method:'CASH', amountCents:1000 }],
    ...(approvalToken ? { approvalToken } : {})
  };
}

async function postReturn(ctx, token, body, mutationId) {
  return fetch(`${ctx.base}/api/v1/returns`, {
    method:'POST',
    headers:headers(token, mutationId),
    body:JSON.stringify(body)
  });
}

test('authorization endpoint authenticates requester and accepts only active manager/admin credentials', async () => {
  const ctx = await setup();
  try {
    let response = await authorize(ctx, 'invalid-session');
    assert.equal(response.status, 401);

    const cashierToken = await login(ctx, 'caixa', CASHIER_PASSWORD);
    response = await authorize(ctx, cashierToken, { password:'senha-incorreta' });
    assert.equal(response.status, 401);

    response = await authorize(ctx, cashierToken, { username:'outrocaixa', password:OTHER_CASHIER_PASSWORD });
    assert.equal(response.status, 403);

    response = await authorize(ctx, cashierToken, { saleId:'missing-sale' });
    assert.notEqual(response.status, 200);
    assert.equal((await response.json()).approvalToken, undefined);

    response = await authorize(ctx, cashierToken);
    assert.equal(response.status, 200);
    const approval = await response.json();
    assert.ok(approval.approvalToken);
    assert.deepEqual(approval.authorizedBy, { id:'manager1', name:'Gerente QA', profileId:'profile-manager' });
    assert.ok(approval.expiresAt);
  } finally { await ctx.cleanup(); }
});

test('cashier return requires a matching one-time manager approval', async () => {
  const ctx = await setup();
  try {
    const cashierToken = await login(ctx, 'caixa', CASHIER_PASSWORD);
    const otherCashierToken = await login(ctx, 'outrocaixa', OTHER_CASHIER_PASSWORD);

    let response = await postReturn(ctx, cashierToken, returnBody(ctx.saleItemId), 'ret-no-approval');
    assert.equal(response.status, 403);

    let approvalResponse = await authorize(ctx, cashierToken);
    assert.equal(approvalResponse.status, 200);
    let approval = await approvalResponse.json();

    response = await postReturn(ctx, otherCashierToken, returnBody(ctx.saleItemId, approval.approvalToken), 'ret-wrong-session');
    assert.equal(response.status, 403);

    approvalResponse = await authorize(ctx, cashierToken);
    approval = await approvalResponse.json();
    response = await postReturn(ctx, cashierToken, returnBody(ctx.sale2ItemId, approval.approvalToken, 'sale2'), 'ret-wrong-sale');
    assert.equal(response.status, 403);

    approvalResponse = await authorize(ctx, cashierToken);
    approval = await approvalResponse.json();
    response = await postReturn(ctx, cashierToken, returnBody(ctx.saleItemId, approval.approvalToken), 'ret-valid');
    assert.equal(response.status, 201);
    const created = (await response.json()).return;
    assert.equal(created.operatorId, 'cashier1');
    assert.equal(created.authorizedById, 'manager1');

    response = await postReturn(ctx, cashierToken, returnBody(ctx.saleItemId, approval.approvalToken), 'ret-replay');
    assert.equal(response.status, 403);
  } finally { await ctx.cleanup(); }
});

test('manager direct return stays compatible and mutation retry is idempotent', async () => {
  const ctx = await setup();
  try {
    const managerToken = await login(ctx, 'gerente', MANAGER_PASSWORD);
    const body = returnBody(ctx.saleItemId);
    let response = await postReturn(ctx, managerToken, body, 'manager-idempotent-return');
    assert.equal(response.status, 201);
    const first = (await response.json()).return;
    assert.equal(first.operatorId, 'manager1');
    assert.equal(first.authorizedById, 'manager1');

    response = await postReturn(ctx, managerToken, body, 'manager-idempotent-return');
    assert.equal(response.status, 201);
    const second = (await response.json()).return;
    assert.equal(second.id, first.id);
    assert.equal(ctx.runtime.returns.listReturns({ saleId:'sale1' }).length, 1);
  } finally { await ctx.cleanup(); }
});
