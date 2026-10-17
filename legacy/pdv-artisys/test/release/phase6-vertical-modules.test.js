'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

function run(file){
  const env={...process.env,NODE_ENV:'test'};
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath,['--test',file],{
    cwd:process.cwd(),
    encoding:'utf8',
    env
  });
}

function outputOf(result){
  return `${result.stdout||''}\n${result.stderr||''}`;
}

test('Phase 6 release gate: capacidades de Alimentação e peso Core passam E2E',()=>{
  const result=run('test/e43-e47-verticals.test.js');
  const output=outputOf(result);
  assert.equal(result.status,0,output);
  for(const marker of ['E43 pizza customization','E45 delivery','E46 fast food','E47 weight is Core']) assert.match(output,new RegExp(marker));
});

test('Phase 6 release gate: variantes Core, legado preservado e autoatendimento removido passam testes focados',()=>{
  const result=run('test/e48-e54-final.test.js');
  const output=outputOf(result);
  assert.equal(result.status,0,output);
  for(const marker of ['E48 Core variants','E49 legacy services schema']) assert.match(output,new RegExp(marker));

  const removal=run('test/self-service-removal.test.js');
  const removalOutput=outputOf(removal);
  assert.equal(removal.status,0,removalOutput);
  assert.match(removalOutput,/autoatendimento paired surface is absent/);
});
