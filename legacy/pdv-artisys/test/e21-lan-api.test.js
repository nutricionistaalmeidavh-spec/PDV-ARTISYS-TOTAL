'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('../server/local-server');

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-lan-api-'));
  let seq = 0;
  const runtime = createPdvRuntime({ dbPath: path.join(dir, 'pdv.sqlite'), idFactory: p => `${p}-${++seq}`, serverVersion: '1.0.0', minimumTerminalVersion: '1.0.0' });
  runtime.catalog.createUser({ id:'admin1', username:'admin', name:'Admin', profileId:'profile-administrator', password:'senha-forte-123' });
  const server = createLocalServer({ runtime, host:'127.0.0.1', port:0, token:'server-install-secret', requireTerminalAuth:true });
  const address = await server.start();
  return { dir, runtime, server, base:`http://${address.host}:${address.port}`, async close(){ await server.stop(); runtime.close(); fs.rmSync(dir,{recursive:true,force:true}); } };
}

async function pair(ctx, terminalId='PDV-02') {
  const pairing = ctx.runtime.terminals.createPairingCode({ createdBy:'admin1' });
  const response = await fetch(`${ctx.base}/api/v1/lan/pair`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ code:pairing.code, terminalId, name:terminalId, fingerprint:`fp-${terminalId}`, appVersion:'1.0.0' }) });
  assert.equal(response.status, 201);
  return response.json();
}

async function login(ctx, paired) {
  const response = await fetch(`${ctx.base}/api/v1/auth/login`, { method:'POST', headers:{'content-type':'application/json','x-terminal-id':paired.terminalId,'x-terminal-key':paired.credential}, body:JSON.stringify({ username:'admin', password:'senha-forte-123', terminalId:paired.terminalId }) });
  assert.equal(response.status, 200);
  return (await response.json()).sessionToken;
}

test('LAN pair is public-by-code, login requires paired terminal credential, and blocked terminal is rejected', async () => {
  const ctx = await fixture();
  try {
    const unpairedLogin = await fetch(`${ctx.base}/api/v1/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'PDV-X'}) });
    assert.equal(unpairedLogin.status, 401);
    const paired = await pair(ctx);
    assert.ok(paired.credential);
    const token = await login(ctx, paired);
    const products = await fetch(`${ctx.base}/api/v1/products`, { headers:{authorization:`Bearer ${token}`} });
    assert.equal(products.status, 200);
    ctx.runtime.terminals.setTerminalStatus(paired.terminalId, 'BLOCKED');
    const blocked = await fetch(`${ctx.base}/api/v1/auth/login`, { method:'POST', headers:{'content-type':'application/json','x-terminal-id':paired.terminalId,'x-terminal-key':paired.credential}, body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:paired.terminalId}) });
    assert.equal(blocked.status, 401);
  } finally { await ctx.close(); }
});

test('handshake reports incompatible client and admin can create next pairing code after login', async () => {
  const ctx = await fixture();
  try {
    const handshake = await fetch(`${ctx.base}/api/v1/lan/handshake?terminalId=PDV-X&appVersion=0.9.0`);
    assert.equal(handshake.status, 200);
    const hs = await handshake.json();
    assert.equal(hs.compatible, false);
    const paired = await pair(ctx);
    const token = await login(ctx, paired);
    const create = await fetch(`${ctx.base}/api/v1/lan/pairing-codes`, { method:'POST', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}, body:'{}' });
    assert.equal(create.status, 201);
    assert.match((await create.json()).code, /^\d{6}$/);
  } finally { await ctx.close(); }
});

test('same mutation id on concurrent cash open returns the same canonical response', async () => {
  const ctx = await fixture();
  try {
    const paired = await pair(ctx);
    const token = await login(ctx, paired);
    const headers = {authorization:`Bearer ${token}`,'content-type':'application/json','x-mutation-id':'cash-open-one'};
    const request = () => fetch(`${ctx.base}/api/v1/cash/sessions`, { method:'POST', headers, body:JSON.stringify({terminalId:paired.terminalId,initialCashCents:5000}) });
    const [a,b] = await Promise.all([request(),request()]);
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    assert.deepEqual(await a.json(), await b.json());
    assert.equal(ctx.runtime.cash.listSessions({terminalId:paired.terminalId}).length, 1);
  } finally { await ctx.close(); }
});
