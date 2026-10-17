const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const startPath = path.join(__dirname, '..', 'server', 'start.js');

test('server start configuration uses safe standalone defaults', () => {
  const { resolveServerConfig } = require(startPath);
  const cwd = path.resolve(os.tmpdir(), 'pdv-artisys-config-test');
  const config = resolveServerConfig({}, cwd);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4174);
  assert.equal(config.dbPath, path.resolve(cwd, 'data', 'pdv-artisys.sqlite'));
  assert.equal(config.token, '');
});

test('LAN binding requires an installation token', () => {
  const { resolveServerConfig } = require(startPath);
  assert.throws(() => resolveServerConfig({ PDV_HOST: '0.0.0.0' }, os.tmpdir()), /PDV_INSTALL_TOKEN/);
  const config = resolveServerConfig({ PDV_HOST: '0.0.0.0', PDV_INSTALL_TOKEN: 'install-secret', PDV_PORT: '5001' }, os.tmpdir());
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 5001);
  assert.equal(config.token, 'install-secret');
});

test('invalid port is rejected', () => {
  const { resolveServerConfig } = require(startPath);
  assert.throws(() => resolveServerConfig({ PDV_PORT: '70000' }, os.tmpdir()), /PDV_PORT/);
});
