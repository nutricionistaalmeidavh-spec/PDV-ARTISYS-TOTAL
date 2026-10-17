'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createUpdaterService } = require('../desktop/updater-service.cjs');

function fakeUpdater() {
  const updater = new EventEmitter();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = true;
  updater.checkCalls = 0;
  updater.downloadCalls = 0;
  updater.installCalls = 0;
  updater.checkForUpdates = async () => { updater.checkCalls += 1; };
  updater.downloadUpdate = async () => { updater.downloadCalls += 1; };
  updater.quitAndInstall = () => { updater.installCalls += 1; };
  updater.setFeedURL = (value) => { updater.feed = value; };
  return updater;
}

test('updater configures manual download and install-on-quit', () => {
  const autoUpdater = fakeUpdater();
  const service = createUpdaterService({ app:{getVersion:()=> '1.4.0',isPackaged:true}, autoUpdater, platform:'win32' });
  assert.equal(autoUpdater.autoDownload,false);
  assert.equal(autoUpdater.autoInstallOnAppQuit,true);
  assert.equal(autoUpdater.allowPrerelease,false);
  assert.equal(service.state().supported,true);
});

test('updater uses generic feed when an update URL is configured', () => {
  const autoUpdater = fakeUpdater();
  createUpdaterService({ app:{getVersion:()=> '1.4.0',isPackaged:true}, autoUpdater, platform:'win32', updateUrl:'https://updates.example/pdv' });
  assert.deepEqual(autoUpdater.feed,{provider:'generic',url:'https://updates.example/pdv'});
});

test('updater emits available, progress and downloaded states', () => {
  const autoUpdater = fakeUpdater();
  const states=[];
  const service = createUpdaterService({ app:{getVersion:()=> '1.4.0',isPackaged:true}, autoUpdater, platform:'win32', onState:(state)=>states.push(state) });
  autoUpdater.emit('update-available',{version:'1.4.1'});
  autoUpdater.emit('download-progress',{percent:42.4});
  autoUpdater.emit('update-downloaded',{version:'1.4.1'});
  assert.equal(states.at(-1).status,'downloaded');
  assert.equal(states.at(-1).availableVersion,'1.4.1');
  assert.equal(states.at(-1).progress,100);
});

test('updater supports check, download and install commands', async () => {
  const autoUpdater = fakeUpdater();
  const service = createUpdaterService({ app:{getVersion:()=> '1.4.0',isPackaged:true}, autoUpdater, platform:'win32' });
  await service.check();
  autoUpdater.emit('update-available',{version:'1.4.1'});
  await service.download();
  autoUpdater.emit('update-downloaded',{version:'1.4.1'});
  service.install();
  assert.equal(autoUpdater.checkCalls,1);
  assert.equal(autoUpdater.downloadCalls,1);
  assert.equal(autoUpdater.installCalls,1);
});

test('updater is unsupported outside packaged Windows', async () => {
  const autoUpdater = fakeUpdater();
  const service = createUpdaterService({ app:{getVersion:()=> '1.4.0',isPackaged:false}, autoUpdater, platform:'win32' });
  assert.equal(service.state().supported,false);
  assert.equal((await service.check()).status,'unsupported');
});

test('updater stays disabled for the isolated legacy runtime', async () => {
  const autoUpdater = fakeUpdater();
  const service = createUpdaterService({ app:{getVersion:()=> '1.4.0',isPackaged:true}, autoUpdater, platform:'win32', enabled:false });
  assert.equal(service.state().supported,false);
  assert.equal((await service.check()).status,'unsupported');
  assert.equal(autoUpdater.checkCalls,0);
});

test('desktop package publishes update metadata for GitHub Releases', () => {
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const html = fs.readFileSync(path.join(root, 'desktop/renderer/index.html'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'desktop/preload.cjs'), 'utf8');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.main, 'desktop/updater-main.cjs');
  assert.equal(pkg.dependencies['electron-updater'], '^6.6.2');
  assert.deepEqual(pkg.build.publish, [{ provider:'github', owner:'nutricionistaalmeidavh-spec', repo:'PDV-ARTISYS', releaseType:'release' }]);
  assert.match(pkg.scripts['lint:desktop'], /updater-main\.cjs/);
  assert.match(pkg.scripts['lint:desktop'], /updater-service\.cjs/);
  assert.match(pkg.scripts['lint:desktop'], /updater-ui\.js/);
  assert.match(html, /updater-ui\.css/);
  assert.match(html, /updater-ui\.js/);
  assert.match(preload, /updater:check/);
  assert.match(preload, /updater:download/);
  assert.match(preload, /updater:install/);
});
