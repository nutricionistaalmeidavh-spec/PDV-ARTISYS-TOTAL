'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {openDatabase}=require('../../js/core/database/sqlite-database');
const {runMigrations}=require('../../js/core/database/migrations');
const {runReleaseMigrations}=require('../../js/core/database/release-migrations');
const {VERTICAL_SCHEMA_VERSION,runVerticalMigrations}=require('../../js/core/database/vertical-migrations');
const {HARDWARE_SCHEMA_VERSION,runHardwareMigrations}=require('../../js/core/database/hardware-migrations');
const {SALE_OBSERVATION_SCHEMA_VERSION,runSaleObservationMigrations}=require('../../js/core/database/sale-observation-migrations');
const {STATUSES}=require('../../js/core/hardware/hardware-compatibility-service');

const root=path.join(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('E48-E54, E54.1 and sale observation remain preserved in the current release with additive schema v10',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
  assert.equal(VERTICAL_SCHEMA_VERSION,8);
  assert.equal(HARDWARE_SCHEMA_VERSION,9);
  assert.equal(SALE_OBSERVATION_SCHEMA_VERSION,10);
  const db=openDatabase(':memory:');
  try{
    runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);runHardwareMigrations(db);runSaleObservationMigrations(db);
    assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,10);
    const vertical=db.prepare('SELECT version,name FROM schema_migrations WHERE version=8').get();
    assert.equal(vertical.name,'pdv_verticals_e48_e54');
    const hardware=db.prepare('SELECT version,name FROM schema_migrations WHERE version=9').get();
    assert.equal(hardware.name,'pdv_hardware_confidence_e54_1');
    const observation=db.prepare('SELECT version,name FROM schema_migrations WHERE version=10').get();
    assert.equal(observation.name,'pdv_sale_observation_1_3_2');
    const columns=new Set(db.prepare('PRAGMA table_info(sales)').all().map(column=>column.name));
    assert.equal(columns.has('observation'),true);
    assert.equal(columns.has('print_observation'),true);
  }finally{db.close();}
});

test('commercial surface stays local non-fiscal and manual-payment',()=>{
  const router=read('server/e48-e54-router.js');
  const notes=read('release/release-notes.md');
  const limitations=JSON.parse(read('release/limitations.json')).join('\n');
  assert.doesNotMatch(router,/runtime\.fiscal|fiscalService|requestFiscalIssue|retryFiscalIssue/);
  assert.match(notes,/NÃO FISCAL/);
  assert.match(notes,/pagamentos manuais/i);
  assert.match(limitations,/não há TEF|TEF/i);
  assert.equal(fs.existsSync(path.join(root,'js','domains','self-service','self-service.js')),false);
});

test('E53 does not claim HTTPS or installable PWA',()=>{
  const notes=read('release/release-notes.md');
  const limitations=JSON.parse(read('release/limitations.json')).join('\n');
  assert.match(notes,/http:\/\/IP-DO-SERVIDOR:4174\/mobile/);
  assert.match(notes,/não declara HTTPS nem PWA instalável/i);
  assert.match(limitations,/não é apresentado como HTTPS/i);
});

test('E54.1 hardware matrix separates protocol evidence from physical field verification',()=>{
  const matrix=JSON.parse(read('release/hardware-compatibility.json'));
  assert.equal(matrix.schemaVersion,2);
  assert.ok(Array.isArray(matrix.entries));
  assert.equal(STATUSES.has('PROTOCOL_VERIFIED'),true);
  assert.equal(STATUSES.has('FIELD_VERIFIED'),true);
  assert.equal(STATUSES.has('UNTESTED_MODEL'),true);
  assert.equal(STATUSES.has('BLOCKED_EXTERNAL'),false);
  assert.equal(STATUSES.has('VERIFIED'),false);
  for(const item of matrix.entries){
    if(['PROTOCOL_VERIFIED','FIELD_VERIFIED'].includes(item.status))assert.ok(item.evidence,`${item.manufacturer} ${item.model} precisa de evidência`);
  }
  for(const kind of ['PRINTER','SCALE','DRAWER','SCANNER']){
    assert.ok(matrix.entries.some(item=>item.kind===kind&&item.status==='PROTOCOL_VERIFIED'),`${kind} deve ter protocolo validado`);
  }
  assert.match(read('docs/operations/hardware-printing.md'),/PDV_SCALE_SETTLE_MS/);
  assert.ok(fs.existsSync(path.join(root,'test','e54-1-hardware-simulation.test.js')));
  assert.ok(fs.existsSync(path.join(root,'test','e54-1-hardware-failure-recovery.test.js')));
});
