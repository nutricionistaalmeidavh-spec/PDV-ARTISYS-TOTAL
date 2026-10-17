'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createAccountService } = require('../js/core/account/account-service');
const { createLocalServer } = require('../server/local-server');

class AccountMemoryStore {
  constructor() {
    this.accounts = new Map();
    this.licenses = [];
    this.tokens = [];
    this.recoveryTokens = [];
    this.installations = new Map();
    this.adminSessions = [];
  }
  async findAccount(email) { return this.accounts.get(email) || null; }
  async findActiveLicense(email) {
    return [...this.licenses].reverse().find(item =>
      item.email === email &&
      item.status === 'ACTIVE' &&
      (!item.expiresAt || item.expiresAt > new Date().toISOString())
    ) || null;
  }
  async saveActivationToken(token) { this.tokens.push({ attempts:0, ...token }); }
  async findActivationToken({ email, digest, now }) {
    return [...this.tokens].reverse().find(item =>
      item.email === email &&
      item.tokenDigest === digest &&
      !item.usedAt &&
      item.expiresAt > now &&
      Number(item.attempts || 0) < 5
    ) || null;
  }
  async findActivationCandidate({ email, now }) {
    return [...this.tokens].reverse().find(item =>
      item.email === email &&
      !item.usedAt &&
      item.expiresAt > now &&
      Number(item.attempts || 0) < 5
    ) || null;
  }
  async incrementActivationAttempts(id) {
    const token = this.tokens.find(item => item.id === id);
    if (token && !token.usedAt) token.attempts = Number(token.attempts || 0) + 1;
  }
  async consumeActivationToken(id, usedAt) {
    const token = this.tokens.find(item => item.id === id);
    if (token) token.usedAt = usedAt;
  }
  async provisionLicense({ email, expiresAt, codeDigest, codeExpiresAt, createdAt }) {
    let account = this.accounts.get(email);
    if (!account) {
      account = { id:`acc-${this.accounts.size + 1}`, email };
      this.accounts.set(email, account);
    }
    this.licenses.filter(item => item.email === email && item.status === 'ACTIVE').forEach(item => { item.status = 'CANCELLED'; });
    const license = { id:`lic-${this.licenses.length + 1}`, accountId:account.id, email, status:'ACTIVE', expiresAt };
    this.licenses.push(license);
    this.tokens.push({
      id:`tok-${this.tokens.length + 1}`,
      accountId:account.id,
      licenseId:license.id,
      installationId:'PENDING',
      email,
      tokenDigest:codeDigest,
      attempts:0,
      expiresAt:codeExpiresAt,
      createdAt
    });
    return { accountId:account.id, licenseId:license.id };
  }
  async listLicenses() {
    return this.licenses.map(item => ({
      id:item.id,
      email:item.email,
      status:item.status,
      expires_at:item.expiresAt,
      installation_id:[...this.installations.values()].find(installation => installation.licenseId === item.id)?.installationId || null
    }));
  }
  async setLicenseStatus(id, status) {
    const license = this.licenses.find(item => item.id === id);
    if (license) license.status = status;
  }
  async createAdminSession(record) { this.adminSessions.push({ ...record }); }
  async findAdminSession({ digest, now }) {
    return this.adminSessions.find(item => item.tokenDigest === digest && !item.revokedAt && item.expiresAt > now) || null;
  }
  async deleteAdminSession(digest) {
    const session = this.adminSessions.find(item => item.tokenDigest === digest);
    if (session) session.revokedAt = new Date().toISOString();
  }
  async saveInstallation(record) { this.installations.set(record.installationId, { ...record }); }
  async findInstallation(id) {
    const stored = this.installations.get(id);
    if (!stored) return null;
    const license = this.licenses.find(item => item.id === stored.licenseId);
    return {
      ...stored,
      status:license?.status || stored.status || null,
      expiresAt:license?.expiresAt || stored.expiresAt || null
    };
  }
  async saveRecoveryToken(token) { this.recoveryTokens.push({ attempts:0, ...token }); }
  async createRecoveryForInstallation({ installationId, email, codeDigest, createdAt, expiresAt }) {
    const installation = await this.findInstallation(installationId);
    if (!installation || installation.accountEmail !== email || installation.status !== 'ACTIVE') return null;
    this.recoveryTokens.push({
      id:`rec-${this.recoveryTokens.length + 1}`,
      accountId:installation.accountId,
      email,
      installationId,
      tokenDigest:codeDigest,
      attempts:0,
      createdAt,
      expiresAt
    });
    return { accountId:installation.accountId };
  }
  async findRecoveryToken({ email, installationId, digest, now }) {
    return [...this.recoveryTokens].reverse().find(item =>
      item.email === email &&
      item.installationId === installationId &&
      item.tokenDigest === digest &&
      !item.usedAt &&
      item.expiresAt > now &&
      Number(item.attempts || 0) < 5
    ) || null;
  }
  async findRecoveryCandidate({ email, installationId, now }) {
    return [...this.recoveryTokens].reverse().find(item =>
      item.email === email &&
      item.installationId === installationId &&
      !item.usedAt &&
      item.expiresAt > now &&
      Number(item.attempts || 0) < 5
    ) || null;
  }
  async incrementRecoveryAttempts(id) {
    const token = this.recoveryTokens.find(item => item.id === id);
    if (token && !token.usedAt) token.attempts = Number(token.attempts || 0) + 1;
  }
  async consumeRecoveryToken(id, usedAt) {
    const token = this.recoveryTokens.find(item => item.id === id);
    if (token) token.usedAt = usedAt;
  }
}

async function loadAccountWorker() {
  return import('../cloudflare/account/src/worker.mjs');
}

function workerRequest(path, init = {}) {
  return new Request('https://account.example' + path, {
    headers:{ 'content-type':'application/json', ...(init.headers || {}) },
    ...init
  });
}

function workerEnv() {
  return {
    ACCOUNT_STORE:new AccountMemoryStore(),
    ACTIVATION_PEPPER:'activation-test',
    RECOVERY_PEPPER:'recovery-test',
    ADMIN_TOKEN:'admin-test'
  };
}

async function adminCookie(handleRequest, env) {
  const response = await handleRequest(workerRequest('/v1/admin/session', {
    method:'POST',
    body:JSON.stringify({ token:'admin-test' })
  }), env);
  assert.equal(response.status, 204);
  return { cookie:String(response.headers.get('set-cookie') || '').split(';')[0] };
}

test('activation code lasts 48 hours and locks after five wrong attempts', async () => {
  const { handleRequest } = await loadAccountWorker();
  const env = workerEnv();
  const before = Date.now();
  const { cookie } = await adminCookie(handleRequest, env);
  let response = await handleRequest(workerRequest('/v1/admin/licenses', {
    method:'POST',
    headers:{ cookie },
    body:JSON.stringify({ email:'owner@example.com' })
  }), env);
  assert.equal(response.status, 201);
  const released = await response.json();
  const remainingMs = Date.parse(released.codeExpiresAt) - before;
  assert.ok(remainingMs >= 48 * 60 * 60 * 1000);
  assert.ok(remainingMs <= 48 * 60 * 60 * 1000 + 60 * 1000);

  const wrongActivationCode = released.code === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await handleRequest(workerRequest('/v1/activation/verify', {
      method:'POST',
      body:JSON.stringify({ installationId:'install-001', email:'owner@example.com', code:wrongActivationCode })
    }), env);
    assert.equal(response.status, 400);
  }

  response = await handleRequest(workerRequest('/v1/activation/verify', {
    method:'POST',
    body:JSON.stringify({ installationId:'install-001', email:'owner@example.com', code:released.code })
  }), env);
  assert.equal(response.status, 400);
});

test('password recovery locks after five wrong codes', async () => {
  const { handleRequest } = await loadAccountWorker();
  const env = workerEnv();
  const { cookie } = await adminCookie(handleRequest, env);
  let response = await handleRequest(workerRequest('/v1/admin/licenses', {
    method:'POST',
    headers:{ cookie },
    body:JSON.stringify({ email:'owner@example.com' })
  }), env);
  const released = await response.json();
  await handleRequest(workerRequest('/v1/activation/verify', {
    method:'POST',
    body:JSON.stringify({ installationId:'install-001', email:'owner@example.com', code:released.code })
  }), env);

  response = await handleRequest(workerRequest('/v1/admin/recovery', {
    method:'POST',
    headers:{ cookie },
    body:JSON.stringify({ installationId:'install-001', email:'owner@example.com' })
  }), env);
  assert.equal(response.status, 201);
  const recovery = await response.json();

  const wrongRecoveryCode = recovery.code === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await handleRequest(workerRequest('/v1/password-recovery/verify', {
      method:'POST',
      body:JSON.stringify({ installationId:'install-001', email:'owner@example.com', code:wrongRecoveryCode })
    }), env);
    assert.equal(response.status, 400);
  }

  response = await handleRequest(workerRequest('/v1/password-recovery/verify', {
    method:'POST',
    body:JSON.stringify({ installationId:'install-001', email:'owner@example.com', code:recovery.code })
  }), env);
  assert.equal(response.status, 400);
});

test('public license status reveals only whether the installation is active', async () => {
  const { handleRequest } = await loadAccountWorker();
  const env = workerEnv();
  const { cookie } = await adminCookie(handleRequest, env);
  let response = await handleRequest(workerRequest('/v1/admin/licenses', {
    method:'POST',
    headers:{ cookie },
    body:JSON.stringify({ email:'owner@example.com' })
  }), env);
  const released = await response.json();
  await handleRequest(workerRequest('/v1/activation/verify', {
    method:'POST',
    body:JSON.stringify({ installationId:'install-001', email:'owner@example.com', code:released.code })
  }), env);

  response = await handleRequest(workerRequest('/v1/license/status?installationId=install-001'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { active:true });

  await env.ACCOUNT_STORE.setLicenseStatus(released.licenseId, 'SUSPENDED');
  response = await handleRequest(workerRequest('/v1/license/status?installationId=install-001'), env);
  assert.deepEqual(await response.json(), { active:false });
});

test('commercial revocation blocks later login when online and remains cached offline', async () => {
  const runtime = createPdvRuntime({ now:() => '2026-10-02T22:00:00.000Z' });
  const installHeaders = { 'content-type':'application/json', 'x-pdv-token':'installation-secret' };
  let online = true;
  try {
    runtime.catalog.createUser({ id:'admin', username:'admin', name:'Admin', profileId:'profile-administrator', password:'senha-forte-123' });
    runtime.db.prepare(`INSERT INTO installation_activation
      (installation_id,account_email,license_id,activated_at,activation_source,metadata_json)
      VALUES (?,?,?,?,?,?)`).run('install-1','owner@example.com','lic-1','2026-10-01T12:00:00.000Z','cloudflare-account',null);

    runtime.account = createAccountService({
      db:runtime.db,
      installationId:'install-1',
      endpoint:'https://account.example',
      requireCommercialActivation:true,
      countUsers:() => runtime.catalog.countUsers(),
      fetchImpl:async (url) => {
        if (!online) throw new Error('offline');
        if (String(url).includes('/v1/license/status')) {
          return { ok:true, status:200, json:async () => ({ active:false }) };
        }
        throw new Error('unexpected url');
      },
      now:() => '2026-10-02T22:00:00.000Z'
    });

    const server = createLocalServer({ runtime, host:'127.0.0.1', port:0, token:'installation-secret' });
    const address = await server.start();
    try {
      let response = await fetch(`http://${address.host}:${address.port}/api/v1/auth/login`, {
        method:'POST',
        headers:installHeaders,
        body:JSON.stringify({ username:'admin', password:'senha-forte-123', terminalId:'PDV-01' })
      });
      assert.equal(response.status, 403);

      online = false;
      response = await fetch(`http://${address.host}:${address.port}/api/v1/auth/login`, {
        method:'POST',
        headers:installHeaders,
        body:JSON.stringify({ username:'admin', password:'senha-forte-123', terminalId:'PDV-01' })
      });
      assert.equal(response.status, 403);
    } finally {
      await server.stop();
    }
  } finally {
    runtime.close();
  }
});

test('offline account service does not block an activated installation unless revocation was already learned', async () => {
  const runtime = createPdvRuntime({ now:() => '2026-10-02T22:00:00.000Z' });
  const installHeaders = { 'content-type':'application/json', 'x-pdv-token':'installation-secret' };
  try {
    runtime.catalog.createUser({ id:'admin', username:'admin', name:'Admin', profileId:'profile-administrator', password:'senha-forte-123' });
    runtime.db.prepare(`INSERT INTO installation_activation
      (installation_id,account_email,license_id,activated_at,activation_source,metadata_json)
      VALUES (?,?,?,?,?,?)`).run('install-1','owner@example.com','lic-1','2026-10-01T12:00:00.000Z','cloudflare-account',null);

    runtime.account = createAccountService({
      db:runtime.db,
      installationId:'install-1',
      endpoint:'https://account.example',
      requireCommercialActivation:true,
      countUsers:() => runtime.catalog.countUsers(),
      fetchImpl:async () => { throw new Error('offline'); },
      now:() => '2026-10-02T22:00:00.000Z'
    });

    const server = createLocalServer({ runtime, host:'127.0.0.1', port:0, token:'installation-secret' });
    const address = await server.start();
    try {
      const response = await fetch(`http://${address.host}:${address.port}/api/v1/auth/login`, {
        method:'POST',
        headers:installHeaders,
        body:JSON.stringify({ username:'admin', password:'senha-forte-123', terminalId:'PDV-01' })
      });
      assert.equal(response.status, 200);
    } finally {
      await server.stop();
    }
  } finally {
    runtime.close();
  }
});

test('cash ledger aggregates repeated payments of the same method', async () => {
  let seq = 0;
  const runtime = createPdvRuntime({
    now:() => `2026-10-02T20:00:${String(seq++ % 60).padStart(2,'0')}Z`,
    idFactory:prefix => `${prefix}-${seq++}`
  });
  const actor = { userId:'admin', profileId:'profile-administrator', terminalId:'PDV-01' };
  try {
    runtime.catalog.createUser({ id:'admin', username:'admin', name:'Admin', profileId:'profile-administrator', password:'senha-forte-123' });
    runtime.catalog.upsertCategory({ id:'general', name:'Geral' }, actor);
    runtime.catalog.upsertProduct({ id:'p1', sku:'P1', name:'Produto', salePriceCents:1000, costCents:500, trackStock:false, minimumStock:0, categoryId:'general' }, actor);
    const cash = runtime.cash.openSession({ id:'cash-1', terminalId:'PDV-01', operatorId:'admin', initialCashCents:0, actor });
    const sale = runtime.sales.openSale({ id:'sale-1', terminalId:'PDV-01', operatorId:'admin' }, actor);
    runtime.sales.addItem(sale.id, { productId:'p1', quantity:1 });
    runtime.sales.completeSale(sale.id, {
      payments:[
        { method:'CASH', amountCents:400 },
        { method:'CASH', amountCents:600 }
      ],
      actor
    });
    const dispatch = await runtime.dispatchPending();
    assert.equal(dispatch.failed, 0);
    const movements = runtime.cash.listSessionMovements(cash.id).filter(item => item.type === 'SALE');
    assert.equal(movements.length, 1);
    assert.equal(movements[0].amountCents, 1000);
  } finally {
    runtime.close();
  }
});

test('business date keeps Sao Paulo late-evening transactions on the local calendar day', () => {
  const { localBusinessDate } = require('../desktop/renderer/business-date');
  const instant = new Date('2026-10-03T00:30:00.000Z');
  assert.equal(localBusinessDate(instant, 'America/Sao_Paulo'), '2026-10-02');
  assert.equal(localBusinessDate(instant, 'UTC'), '2026-10-03');
});
