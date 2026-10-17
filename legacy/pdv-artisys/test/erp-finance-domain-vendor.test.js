'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('finance-domain is pinned and importable',async()=>{
  const lock=JSON.parse(fs.readFileSync('vendor/artisys-modules.lock.json','utf8'));
  assert.equal(lock.modules['@artisys/finance-domain'].version,'0.1.0');
  const mod=await import('../vendor/artisys-finance-domain/src/index.mjs');
  for(const name of ['sourceFingerprint','businessFingerprint','applyDeterministicRules','suggestReconciliation']) assert.equal(typeof mod[name],'function');
});
