'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createSettingsService}=require('../js/core/settings/settings-service');

function fixture(){const db=openDatabase(':memory:');let tick=0;const now=()=>new Date(1788999600000+tick++*1000).toISOString();runMigrations(db,now);
  const authorization={can:({principal,capability})=>principal?.kind==='system'||(principal?.kind==='human'&&['admin','ger'].includes(principal.id)&&['settings.manage','modules.manage'].includes(capability))};
  return{db,now,authorization};}

test('settings persist typed JSON values by scope and preserve defaults',()=>{
 const {db,now,authorization}=fixture();try{
  const settings=createSettingsService({db,authorization,now});
  assert.equal(settings.get('store.name',{scope:'global',defaultValue:'Loja Matriz'}),'Loja Matriz');
  settings.set('store.name','ArtiSys Centro',{scope:'global',actor:{kind:'human',userId:'admin'}});
  settings.set('print.width',42,{scope:'terminal:PDV-01',actor:{kind:'human',userId:'ger'}});
  settings.set('cash.requireOpening',true,{scope:'global',actor:{kind:'human',userId:'admin'}});
  assert.equal(settings.get('store.name',{scope:'global'}),'ArtiSys Centro');
  assert.equal(settings.get('print.width',{scope:'terminal:PDV-01'}),42);
  assert.equal(settings.get('cash.requireOpening',{scope:'global'}),true);
  assert.equal(settings.get('print.width',{scope:'terminal:PDV-02',defaultValue:48}),48);
 }finally{db.close();}
});

test('settings list supports scope and prefix filters and returns public values only',()=>{
 const {db,now,authorization}=fixture();try{
  const settings=createSettingsService({db,authorization,now});const actor={kind:'human',userId:'admin'};
  settings.set('store.name','Loja 1',{scope:'global',actor});settings.set('store.city','Ribeirao Preto',{scope:'global',actor});settings.set('print.width',42,{scope:'global',actor});
  const rows=settings.list({scope:'global',prefix:'store.'});
  assert.deepEqual(rows.map(r=>r.key),['store.city','store.name']);
  assert.equal(rows.every(r=>r.scope==='global'),true);
 }finally{db.close();}
});

test('secret-like settings are rejected and critical writes require settings.manage',()=>{
 const {db,now,authorization}=fixture();try{
  const settings=createSettingsService({db,authorization,now});
  for(const key of ['fiscal.token','lan.secret','api.password','authorization.header','terminal.credential']){
   assert.throws(()=>settings.set(key,'x',{scope:'global',actor:{userId:'a',profileId:'profile-administrator'}}),/segredo|sensivel/i);
  }
  assert.throws(()=>settings.set('store.name','X',{scope:'global',actor:{kind:'human',userId:'cash'}}),/permissao/i);
  assert.doesNotThrow(()=>settings.set('ui.compactMode',true,{scope:'user:cash',actor:{kind:'human',userId:'cash'}}));
 }finally{db.close();}
});

test('setting changes are audited without storing secret material',()=>{
 const {db,now,authorization}=fixture();try{
  const settings=createSettingsService({db,authorization,now});
  settings.set('backup.retention',30,{scope:'global',actor:{kind:'human',userId:'admin'}});
  const row=db.prepare("SELECT action,entity,context_json AS context FROM audit_log WHERE action='settings.update'").get();
  assert.equal(row.entity,'setting');
  assert.equal(row.context.includes('backup.retention'),true);
  assert.equal(row.context.includes('password'),false);
 }finally{db.close();}
});
