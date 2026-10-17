'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createTelemetryIdentity}=require('../js/core/telemetry/telemetry-identity');
const {createTelemetryService}=require('../js/core/telemetry/telemetry-core');

function createSettings(values){const map=new Map(Object.entries(values));return{get:(key,{defaultValue}={})=>map.has(key)?map.get(key):defaultValue,set:(key,value)=>{map.set(key,value);return{key,value};}};}

test('telemetry enabled flag alone never collects before versioned consent',()=>{
  const db=new DatabaseSync(':memory:');
  const settings=createSettings({'telemetry.enabled':true,'telemetry.diagnostics':true,'telemetry.endpoint':'https://t.invalid'});
  const identity=createTelemetryIdentity({db,randomUUID:()=> '00000000-0000-4000-8000-000000000001'});
  const telemetry=createTelemetryService({db,settings,identity,appVersion:'1.4.1',releaseId:'test'});
  assert.equal(telemetry.record('screen_opened',{dimensions:{route:'sales'}}),false);
  assert.equal(telemetry.status().enabled,false);
  assert.equal(telemetry.status().pending,0);
  db.close();
});
