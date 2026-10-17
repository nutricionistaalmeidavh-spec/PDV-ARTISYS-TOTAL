'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateRegistry } = require('../scripts/check-customer-capability-parity');

function tempRepo(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-capability-'));
  fs.mkdirSync(path.join(root,'js'),{recursive:true});
  fs.mkdirSync(path.join(root,'desktop','renderer'),{recursive:true});
  fs.writeFileSync(path.join(root,'js','feature.js'),'module.exports = {};');
  fs.writeFileSync(path.join(root,'desktop','renderer','feature-ui.js'),"window.FeatureUi = { renderFeature(){} };\n");
  return root;
}

test('customer capabilities fail when backend exists but customer UI is missing',()=>{
  const root=tempRepo();
  const registry={schemaVersion:1,capabilities:[{
    id:'feature.customer',exposure:'customer',status:'supported',
    backend:[{path:'js/feature.js',marker:'module.exports'}],
    api:[{path:'js/feature.js',marker:'module.exports'}],
    client:[{path:'desktop/renderer/feature-ui.js',marker:'FeatureUi'}],
    ui:[]
  }]};
  const result=validateRegistry({root,registry});
  assert.equal(result.ok,false);
  assert.match(result.errors.join('\n'),/feature\.customer.*ui/i);
  fs.rmSync(root,{recursive:true,force:true});
});

test('internal capabilities do not require a customer surface',()=>{
  const root=tempRepo();
  const registry={schemaVersion:1,capabilities:[{
    id:'infra.outbox',exposure:'internal',status:'supported',
    backend:[{path:'js/feature.js',marker:'module.exports'}],api:[],client:[],ui:[]
  }]};
  const result=validateRegistry({root,registry});
  assert.equal(result.ok,true,result.errors.join('\n'));
  fs.rmSync(root,{recursive:true,force:true});
});

test('real capability registry has backend API/client/UI parity',()=>{
  const root=path.resolve(__dirname,'..');
  const registry=JSON.parse(fs.readFileSync(path.join(root,'release','customer-capabilities.json'),'utf8'));
  const result=validateRegistry({root,registry});
  assert.equal(result.ok,true,result.errors.join('\n'));
  assert.ok(result.counts.customerAdmin>0);
  assert.equal(result.counts.surfaceComplete,result.counts.customerAdmin);
});
