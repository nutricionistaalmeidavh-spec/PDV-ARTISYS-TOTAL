'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function source(relative){return fs.readFileSync(path.join(__dirname,'..',relative),'utf8');}

test('desktop wires auditable manual print API and never auto-processes manual reprints',()=>{
  const main=source('desktop/main.cjs');
  assert.match(main,/createPrintAttempt\s*:/);
  assert.match(main,/finishPrintAttempt\s*:/);
  assert.match(main,/listJobs\(\{\s*status:\s*'PENDING'\s*,\s*type:\s*'SALE_RECEIPT'\s*\}\)/);
});

test('new install state reaches both desktop printing resolver and receipt API',()=>{
  const main=source('desktop/main.cjs');
  const localServer=source('server/local-server.js');
  assert.match(main,/existsSync\(dbPath\)/);
  assert.match(main,/isExistingInstall:\s*installationWasExisting/);
  assert.match(main,/createLocalServer\(\{[^}]*isExistingInstall:\s*installationWasExisting/s);
  assert.match(localServer,/function createLocalServer\(\{[^}]*isExistingInstall=true/s);
  assert.match(localServer,/createReceiptRouter\(\{runtime,sessionStore,isExistingInstall\}\)/);
});