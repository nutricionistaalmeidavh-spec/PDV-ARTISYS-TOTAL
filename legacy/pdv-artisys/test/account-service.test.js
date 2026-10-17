'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createAccountService } = require('../js/core/account/account-service');

function runtime() {
  return createPdvRuntime({ now: () => '2026-09-25T21:00:00.000Z', idFactory: prefix => `${prefix}-1` });
}

test('mandatory commercial activation fails closed when the endpoint is missing', () => {
  const ctx = runtime();
  try {
    const account = createAccountService({ db:ctx.db, installationId:'install-1', requireCommercialActivation:true, endpoint:'', countUsers:()=>ctx.catalog.countUsers() });
    assert.deepEqual(account.status(), { configured:false, required:true, activated:false, activation:null });
  } finally { ctx.close(); }
});

test('runtime exposes account service but keeps it disabled by default',()=>{
  const ctx=runtime();
  try{assert.ok(ctx.account);assert.deepEqual(ctx.account.status(),{configured:false,required:false,activated:false,activation:null});}
  finally{ctx.close();}
});

test('runtime can explicitly enable commercial activation for a new installation',()=>{
  const ctx=createPdvRuntime({installationId:'install-2',accountEndpoint:'https://account.example',requireCommercialActivation:true,accountFetchImpl:async()=>({ok:true,status:200,json:async()=>({})})});
  try{assert.equal(ctx.account.status().required,true);}
  finally{ctx.close();}
});

test('existing unactivated installation still requires commercial activation', () => {
  const ctx = runtime();
  try {
    ctx.catalog.createUser({ username:'admin', name:'Admin', profileId:'profile-administrator', password:'senha-forte-123' });
    const account = createAccountService({ db:ctx.db, installationId:'install-1', requireCommercialActivation:true, endpoint:'https://account.example', countUsers:()=>ctx.catalog.countUsers() });
    assert.equal(account.status().required, true);
  } finally { ctx.close(); }
});

test('new configured installation verifies activation remotely and persists only commercial identity', async () => {
  const ctx = runtime();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/activation/request')) return { ok:true, status:202, json:async()=>({ accepted:true }) };
    if (url.endsWith('/v1/activation/verify')) return { ok:true, status:200, json:async()=>({ licenseId:'lic-1', accountEmail:'Owner@Example.COM' }) };
    throw new Error('unexpected url');
  };
  try {
    const account = createAccountService({ db:ctx.db, installationId:'install-1', requireCommercialActivation:true, endpoint:'https://account.example/', fetchImpl, countUsers:()=>ctx.catalog.countUsers(), now:()=> '2026-09-25T21:00:00.000Z' });
    assert.equal(account.status().required, true);
    await account.requestActivation(' Owner@Example.COM ');
    const activation = await account.verifyActivation({ email:'Owner@Example.COM', code:'123456' });
    assert.equal(activation.licenseId, 'lic-1');
    assert.equal(activation.accountEmail, 'owner@example.com');
    assert.equal(account.status().required, false);
    assert.equal(calls.length, 2);

    const row = ctx.db.prepare('SELECT installation_id,account_email,license_id,activation_source FROM installation_activation WHERE installation_id=?').get('install-1');
    assert.deepEqual({ ...row }, { installation_id:'install-1', account_email:'owner@example.com', license_id:'lic-1', activation_source:'cloudflare-account' });
    const userColumns = ctx.db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
    assert.ok(userColumns.includes('password_hash'));
  } finally { ctx.close(); }
});

test('remote activation failure is surfaced without changing local activation state', async () => {
  const ctx = runtime();
  try {
    const account = createAccountService({
      db:ctx.db,
      installationId:'install-1',
      requireCommercialActivation:true,
      endpoint:'https://account.example',
      countUsers:()=>ctx.catalog.countUsers(),
      fetchImpl:async()=>{ throw new Error('offline'); }
    });
    await assert.rejects(account.requestActivation('owner@example.com'), /indisponivel/i);
    assert.equal(account.activation(), null);
  } finally { ctx.close(); }
});