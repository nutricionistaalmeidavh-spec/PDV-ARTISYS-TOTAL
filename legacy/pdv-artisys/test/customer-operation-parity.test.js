'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {validateOperationRegistry}=require('../scripts/check-customer-capability-parity');

function tempRepo(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-operation-'));
  for(const dir of ['js','server','desktop/renderer'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'js','feature.js'),'function runFeature(){}');
  fs.writeFileSync(path.join(root,'server','feature.js'),'routeFeature();');
  fs.writeFileSync(path.join(root,'desktop','renderer','client.js'),'runFeatureClient();');
  fs.writeFileSync(path.join(root,'desktop','renderer','ui.js'),'<button id="feature-action">Run</button>');
  return root;
}

const capabilities={capabilities:[{id:'feature.customer'}]};

test('operation parity fails when one operation layer marker is absent',()=>{
  const root=tempRepo();
  const registry={schemaVersion:1,operations:[{
    id:'feature.run',capabilityId:'feature.customer',exposure:'customer',
    backend:[{path:'js/feature.js',marker:'runFeature'}],
    api:[{path:'server/feature.js',marker:'routeFeature'}],
    client:[{path:'desktop/renderer/client.js',marker:'runFeatureClient'}],
    ui:[{path:'desktop/renderer/ui.js',marker:'missing-action'}]
  }]};
  const result=validateOperationRegistry({root,registry,capabilityRegistry:capabilities,require100:true,required:true});
  assert.equal(result.ok,false);
  assert.match(result.errors.join('\n'),/feature\.run.*ui marker missing/i);
  fs.rmSync(root,{recursive:true,force:true});
});

test('operation registry has complete backend -> API -> client -> UI traceability',()=>{
  const root=path.resolve(__dirname,'..');
  const capabilityRegistry=JSON.parse(fs.readFileSync(path.join(root,'release','customer-capabilities.json'),'utf8'));
  const registry=JSON.parse(fs.readFileSync(path.join(root,'release','customer-operations.json'),'utf8'));
  const result=validateOperationRegistry({root,registry,capabilityRegistry,require100:true,required:true});
  assert.equal(result.ok,true,result.errors.join('\n'));
  assert.ok(result.counts.surface>=18);
  assert.equal(result.counts.complete,result.counts.surface);
  assert.equal(result.counts.coveragePercent,100);
});

test('P1 renderer enhancement parses and is loaded by the desktop shell',()=>{
  const root=path.resolve(__dirname,'..');
  const file=path.join(root,'desktop','renderer','vertical-parity-p1.js');
  const parsed=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(parsed.status,0,`${parsed.stdout||''}\n${parsed.stderr||''}`);
  const html=fs.readFileSync(path.join(root,'desktop','renderer','index.html'),'utf8');
  assert.match(html,/vertical-parity-p1\.js/);
});
