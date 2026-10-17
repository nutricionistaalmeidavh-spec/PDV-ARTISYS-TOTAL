'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const config = require('../desktop/data-server-config.cjs');
const {
  localBusinessDataSummary,
  migrateLegacyDataServerCredential,
  saveDataServerSelection,
  testDataServerTarget
} = require('../desktop/data-server-runtime.cjs');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisys-data-hardening-'));
  return path.join(dir, 'data-server.json');
}

test('switching a local installation to principal PC opens the LAN listener', () => {
  const file=tempFile();
  const principal=saveDataServerSelection({filePath:file,currentConfig:{mode:'local',host:'127.0.0.1'},input:{mode:'lan-host',port:4297}});
  assert.equal(principal.host,'0.0.0.0');
  assert.equal(principal.port,4297);
  assert.equal(config.loadDataServerConfig(file).host,'0.0.0.0');
  const local=saveDataServerSelection({filePath:file,currentConfig:principal,input:{mode:'local'}});
  assert.equal(local.host,'127.0.0.1');
});

function memoryCredentialStore(initial='') {
  let secret = initial;
  return {
    save(value) { secret = String(value); return { configured:true }; },
    load() { return secret || null; },
    status() { return { configured:Boolean(secret), encryptionAvailable:true }; },
    get value() { return secret; }
  };
}

test('data-server.json never persists terminal secret', () => {
  const file = tempFile();
  config.saveDataServerConfig(file, {
    mode:'lan-client',
    serverUrl:'http://192.168.0.10:4174',
    terminalId:'PDV-02',
    terminalKey:'segredo-super-secreto'
  });
  const raw = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(raw, /segredo-super-secreto/);
  assert.doesNotMatch(raw, /terminalKey/);
  const loaded = config.loadDataServerConfig(file);
  assert.equal(loaded.mode, 'lan-client');
  assert.equal(loaded.serverUrl, 'http://192.168.0.10:4174');
});

test('legacy terminal key is migrated from json into credential store and scrubbed from disk', () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({
    selected:true,
    mode:'lan-client',
    serverUrl:'http://192.168.0.10:4174',
    terminalId:'PDV-02',
    terminalKey:'legacy-secret'
  }));
  const store = memoryCredentialStore();
  const loaded = config.loadDataServerConfig(file);
  const migrated = migrateLegacyDataServerCredential({ config:loaded, filePath:file, credentialStore:store });
  assert.equal(store.value, 'legacy-secret');
  assert.equal(migrated.mode, 'lan-client');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /legacy-secret|terminalKey/);
});

test('local data guard detects finance data even without sales products or customers', () => {
  const runtime = createPdvRuntime();
  try {
    let summary = localBusinessDataSummary(runtime.db);
    assert.equal(summary.hasData, false);
    runtime.finance.createEntry({
      id:'fin-only', kind:'PAYABLE', description:'Conta sem catálogo', amountCents:1000, dueAt:'2026-10-10T12:00:00Z'
    }, { userId:'admin', profileId:'profile-administrator' });
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS total FROM sales').get().total, 0);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS total FROM products').get().total, 0);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS total FROM customers').get().total, 0);
    summary = localBusinessDataSummary(runtime.db);
    assert.equal(summary.hasData, true);
    assert.ok(summary.tables.some(item=>item.table==='financial_entries'&&item.total===1));
  } finally { runtime.close(); }
});

test('switch to external server is blocked by any local business data before credential is changed', () => {
  const runtime = createPdvRuntime();
  const file = tempFile();
  const store = memoryCredentialStore('existing-secret');
  try {
    runtime.finance.createEntry({
      id:'fin-only', kind:'PAYABLE', description:'Conta local', amountCents:1000, dueAt:'2026-10-10T12:00:00Z'
    });
    assert.throws(() => saveDataServerSelection({
      db:runtime.db,
      filePath:file,
      input:{ mode:'lan-client', serverUrl:'http://192.168.0.10:4174', terminalId:'PDV-02', terminalKey:'new-secret' },
      currentConfig:{ mode:'local' },
      credentialStore:store
    }), /dados locais/i);
    assert.equal(store.value, 'existing-secret');
  } finally { runtime.close(); }
});

test('server test validates terminal id and key after health check', async () => {
  const calls = [];
  const fetchImpl = async (url, options={}) => {
    calls.push({ url, options });
    if (String(url).endsWith('/api/v1/health')) return { ok:true, status:200 };
    return { ok:false, status:401 };
  };
  const store = memoryCredentialStore();
  await assert.rejects(
    () => testDataServerTarget({
      input:{ serverUrl:'http://192.168.0.10:4174', terminalId:'PDV-02', terminalKey:'wrong-secret' },
      currentConfig:{ mode:'local' },
      credentialStore:store,
      fetchImpl
    }),
    /terminal|chave|credencial/i
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers['x-terminal-id'], 'PDV-02');
  assert.equal(calls[1].options.headers['x-terminal-key'], 'wrong-secret');
});

test('desktop main wires guarded save, legacy credential migration and authenticated connection test', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /saveDataServerSelection/);
  assert.match(main, /migrateLegacyDataServerCredential/);
  assert.match(main, /testDataServerTarget/);
  assert.doesNotMatch(main, /terminalKey\s*:\s*dataServerConfig\.terminalKey/);
});
