'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {openDatabase}=require('../../js/core/database/sqlite-database');
const {runMigrations}=require('../../js/core/database/migrations');
const {runReleaseMigrations}=require('../../js/core/database/release-migrations');
const {runVerticalMigrations}=require('../../js/core/database/vertical-migrations');

const root=path.join(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('E40-E47 migrations remain preserved in the current release',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
  const db=openDatabase(':memory:');
  try{
    runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);
    const current=db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    assert.ok(current>=7);
    const rows=db.prepare('SELECT version,name FROM schema_migrations WHERE version IN (6,7) ORDER BY version').all();
    assert.equal(rows.length,2);
    assert.equal(rows[0].version,6);
    assert.equal(rows[0].name,'pdv_modular_foundation_e40_e42');
    assert.equal(rows[1].version,7);
    assert.equal(rows[1].name,'pdv_verticals_e43_e47');
  }finally{db.close();}
});

test('E40-E47 commercial vertical router remains local manual-payment and non-fiscal',()=>{
  const vertical=read('server/vertical-router.js');
  const runtime=read('js/core/pdv-runtime.js');
  const notes=read('release/release-notes.md');
  assert.doesNotMatch(vertical,/runtime\.fiscal|fiscalService|requestFiscalIssue|retryFiscalIssue/);
  assert.match(runtime,/registerNonFiscalEffects/);
  assert.match(notes,/NÃO FISCAL/);
  assert.match(notes,/pagamentos manuais/i);
  assert.match(notes,/local-first/i);
});

test('E40-E47 release includes optional-module UI and configured-item production rendering',()=>{
  const html=read('desktop/renderer/index.html');
  const kitchen=read('js/domains/restaurant/kitchen-service.js');
  const receipt=read('js/domains/printing/receipt-renderer.js');
  assert.match(html,/vertical-modules\.js/);
  assert.match(kitchen,/configuration_json/);
  assert.match(receipt,/configurationDetails/);
});
