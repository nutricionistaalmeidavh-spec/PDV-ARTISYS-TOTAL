'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const XLSX=require('xlsx');
const {openDatabase}=require('../../js/core/database/sqlite-database');
const {runMigrations}=require('../../js/core/database/migrations');
const {createCatalogService}=require('../../js/domains/catalog/catalog-service');
const {createInventoryService}=require('../../js/domains/inventory/inventory-service');
const {createImportService}=require('../../js/core/import/import-service');

const root=path.resolve(__dirname,'../..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

function cleanTestEnv(){
  const env={...process.env,NODE_ENV:'test'};
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function run(file){
  return spawnSync(process.execPath,['--test',file],{cwd:root,encoding:'utf8',env:cleanTestEnv()});
}

function outputOf(result){return `${result.stdout||''}\n${result.stderr||''}`;}

test('Phase 7 release gate: backup restore import updater printing diagnostics and hardware simulations pass',()=>{
  for(const file of [
    'test/e22-backup.test.js',
    'test/e24-import.test.js',
    'test/e25-diagnostics.test.js',
    'test/e19-printing.test.js',
    'test/updater-service.test.js',
    'test/e54-1-hardware-simulation.test.js'
  ]){
    const result=run(file);
    assert.equal(result.status,0,`${file}\n${outputOf(result)}`);
  }
});

test('Phase 7 release gate: XLSX preview and commit work through the real import service',()=>{
  const db=openDatabase(':memory:');
  try{
    runMigrations(db);
    let seq=0;
    const now=()=>new Date(1790000000000+seq++*1000).toISOString();
    const idFactory=prefix=>`${prefix}-${++seq}`;
    const catalog=createCatalogService({db,now,idFactory});
    const inventory=createInventoryService({db,now,idFactory});
    const imports=createImportService({db,catalog,inventory,now,idFactory});
    const sheet=XLSX.utils.json_to_sheet([{sku:'XLSX-001',name:'Produto XLSX',salePriceCents:1590,costCents:900,minimumStock:2}]);
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,sheet,'Produtos');
    const content=XLSX.write(workbook,{bookType:'xlsx',type:'base64'});
    const preview=imports.preview({type:'products',format:'xlsx',content,collisionPolicy:'CREATE'});
    assert.equal(preview.summary.valid,1);
    assert.equal(preview.summary.invalid,0);
    const committed=imports.commit(preview.batchId,{actor:{userId:'admin',profileId:'profile-administrator'}});
    assert.equal(committed.status,'COMMITTED');
    assert.equal(catalog.listProducts()[0].sku,'XLSX-001');
  }finally{db.close();}
});

test('Phase 7 release gate: admin operations are exposed in customer-visible desktop UI',()=>{
  const admin=read('desktop/renderer/admin-ops.js');
  const hardware=read('desktop/renderer/e48-e54-ui.js');
  const updater=read('desktop/renderer/updater-ui.js');
  const html=read('desktop/renderer/index.html');

  for(const marker of [
    'ops-admin-control-center','ops-backup-now','data-backup-validate','data-backup-restore',
    'ops-backup-pending','ops-backup-restore-modal','Restaurar este backup','Restauração pendente',
    'ops-import-pick','ops-import-preview','ops-import-commit','ops-create-diagnostics'
  ]) assert.match(admin,new RegExp(marker));

  for(const marker of ['e54-hardware-card','hw-refresh','hw-printer','hw-scale','hw-drawer']) assert.match(hardware,new RegExp(marker));
  for(const marker of ['updaterPrimary','updaterDismiss','downloaded','Baixar agora','Atualizar e reiniciar']) assert.match(updater,new RegExp(marker));
  assert.match(html,/admin-ops\.js/);
  assert.match(html,/e48-e54-ui\.js/);
  assert.match(html,/updater-ui\.js/);
});
