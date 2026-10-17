'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

function cleanTestEnv(){
  const env={...process.env,NODE_ENV:'test'};
  delete env.NODE_TEST_CONTEXT;
  return env;
}

test('Phase 5 release gate: restaurante, KDS e mobile LAN passam no fluxo E2E durável',()=>{
  const result=spawnSync(process.execPath,['--test','test/e30-e39-restaurant.test.js'],{
    cwd:process.cwd(),
    encoding:'utf8',
    env:cleanTestEnv()
  });
  const output=`${result.stdout||''}\n${result.stderr||''}`;
  assert.equal(result.status,0,output);
  assert.match(output,/E30-E39: migration, comanda, KDS, prebill, checkout and sale close form one durable flow/);
  assert.match(output,/mobile credentials are hashed, revocable and authorize only the local device flows/);
  assert.match(output,/repeated mutation id produces one waiter table open/);
});
