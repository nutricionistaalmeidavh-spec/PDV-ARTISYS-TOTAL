'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../desktop/data-server-config.cjs');

test('instalação sem escolha permanece local e não hospeda a LAN', () => {
  const value = config.loadDataServerConfig(path.join(os.tmpdir(), `missing-${Date.now()}.json`));
  assert.equal(value.mode, 'local');
  assert.equal(value.selected, false);
  assert.equal(config.isHostMode(value), false);
});

test('persiste escolha explícita de PC principal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisys-data-server-'));
  const file = path.join(dir, 'data-server.json');
  const saved = config.saveDataServerConfig(file, { mode:'lan-host', port:4555 });
  assert.equal(saved.selected, true);
  assert.equal(config.loadDataServerConfig(file).port, 4555);
});

test('terminal cliente exige endereço e chave sem fallback', () => {
  assert.throws(() => config.normalize({ mode:'lan-client', serverUrl:'http://192.168.0.10:4174' }), /credencial|chave/i);
  const value = config.normalize({ mode:'lan-client', serverUrl:'http://192.168.0.10:4174', terminalKey:'secret' });
  assert.equal(config.isExternalMode(value), true);
});

test('servidor próprio remoto exige HTTPS', () => {
  assert.throws(() => config.normalize({ mode:'own-server', serverUrl:'http://example.com', terminalKey:'secret' }), /HTTPS/);
});
