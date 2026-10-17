'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createTelemetryIdentity}=require('../js/core/telemetry/telemetry-identity');
const {createTelemetryQueue}=require('../js/core/telemetry/telemetry-queue');

test('telemetry identity persists installation and maps terminals to random ids',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'telemetry-id-'));const dbPath=path.join(dir,'db.sqlite');let n=0;const uuid=()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`;
 let db=new DatabaseSync(dbPath);let id=createTelemetryIdentity({db,randomUUID:uuid});const installation=id.installationId();const t1=id.terminalId('PDV-REAL-01');assert.equal(id.terminalId('PDV-REAL-01'),t1);const t2=id.terminalId('PDV-REAL-02');assert.notEqual(t1,t2);db.close();
 db=new DatabaseSync(dbPath);id=createTelemetryIdentity({db,randomUUID:uuid});assert.equal(id.installationId(),installation);assert.equal(id.terminalId('PDV-REAL-01'),t1);db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('telemetry queue survives restart and trims flow before error at hard cap',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'telemetry-q-'));const dbPath=path.join(dir,'db.sqlite');let nowN=0;const now=()=>new Date(Date.UTC(2026,8,25,10,0,nowN++)).toISOString();
 let db=new DatabaseSync(dbPath);let q=createTelemetryQueue({db,now,maxPending:3});
 q.enqueue({id:'f1',eventName:'screen_opened',payload:{x:1}});q.enqueue({id:'e1',eventName:'operation_failed',payload:{x:2}});q.enqueue({id:'f2',eventName:'screen_opened',payload:{x:3}});q.enqueue({id:'e2',eventName:'fiscal_failed',payload:{x:4}});
 assert.equal(q.count(),3);const names=q.listReady(10).map(x=>x.eventName);assert.equal(names.includes('operation_failed'),true);assert.equal(names.includes('fiscal_failed'),true);assert.equal(names.filter(x=>x==='screen_opened').length,1);db.close();
 db=new DatabaseSync(dbPath);q=createTelemetryQueue({db,now,maxPending:3});assert.equal(q.count(),3);q.ack(['e1']);assert.equal(q.count(),2);db.close();fs.rmSync(dir,{recursive:true,force:true});
});
