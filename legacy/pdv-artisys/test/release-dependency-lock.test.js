'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('root dependency graph is locked for reproducible CI and releases',()=>{
  const lockPath=path.join(root,'package-lock.json');
  assert.equal(fs.existsSync(lockPath),true,'package-lock.json raiz deve existir');
  const lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));
  assert.equal(lock.lockfileVersion,3);
  assert.equal(lock.packages?.['']?.name,'pdv-artisys');
});

test('root GitHub workflows install the locked graph with npm ci',()=>{
  for(const rel of ['.github/workflows/verify.yml','.github/workflows/release-windows.yml','.github/workflows/qa-capture.yml']){
    const source=read(rel);
    assert.match(source,/npm ci(?:\s|$)/,`${rel} deve usar npm ci`);
    assert.doesNotMatch(source,/npm install --no-audit --no-fund/,`${rel} nao deve reinstalar grafo flutuante`);
  }
});

test('legacy Windows installer pipeline is retired',()=>{
  for(const rel of ['.github/workflows/build-windows-legacy.yml','electron-builder.legacy.yml','scripts/prepare-legacy-runtime.cjs']){
    assert.equal(fs.existsSync(path.join(root,rel)),false,`${rel} nao deve existir em releases futuras`);
  }
});
