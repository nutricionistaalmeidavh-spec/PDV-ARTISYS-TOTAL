import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCrosscutProfile } from '../qa/runtime/src/crosscut-profile.js';

const root=path.resolve('.');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');
test('legacy crosscut E2E is not exposed through package scripts or CI',()=>{
  const pkg=readJson('package.json');
  const workflow=readText('.github/workflows/verify.yml');
  assert.equal(pkg.scripts['qa:crosscut'],undefined);
  assert.doesNotMatch(workflow,/qa:crosscut|crosscut QA gate|pdv-e2e/);
});

test('runCrosscutProfile executes only configured crosscut flows and builds an independent product gate',async()=>{
  const calls=[];const manifest={systemId:'fixture',mode:'web',defaultEnvironment:'ci',defaultViewport:'desktop',environments:{ci:{baseURL:'http://local.test'}},flows:{cross:'flows/cross.json',unrelated:'flows/unrelated.json'},crosscut:{flows:['cross'],policy:{maxConsoleErrors:0,maxHttp5xx:0,maxRequestFailures:0}}};
  const result=await runCrosscutProfile({manifest,rootDir:process.cwd(),outputRoot:path.join(process.cwd(),'tmp-crosscut-artifacts'),flowRunner:async({flowName})=>{calls.push(flowName);return{outputDir:path.join(process.cwd(),'fake-'+flowName),summary:{status:'passed',flow:flowName}};},telemetryReader:async()=>[],bundleWriter:async({summary})=>({outputDir:'fixture-bundle',files:{summaryJson:'fixture-summary.json'},summary})});
  assert.deepEqual(calls,['cross']);assert.equal(result.summary.status,'PASS');assert.equal(result.summary.gate.allowed,true);assert.equal(result.summary.checks.some(item=>item.name==='flow:cross'&&item.status==='passed'),true);assert.equal(result.summary.checks.some(item=>item.name==='renderer-health'&&item.status==='passed'),true);
});

test('runCrosscutProfile fails fast when no dedicated crosscut flows are configured',async()=>{await assert.rejects(()=>runCrosscutProfile({manifest:{systemId:'fixture',mode:'web',defaultEnvironment:'ci',defaultViewport:'desktop',environments:{ci:{baseURL:'http://local.test'}},flows:{smoke:'flows/smoke.json'}},rootDir:process.cwd()}),/crosscut flows/i);});
