import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveQaProfile } from '../qa/runtime/src/profiles.js';
import { runQaProfile } from '../qa/runtime/src/profile-runner.js';
import { runRendererHealthContract } from '../qa/runtime/src/contracts/renderer-health.js';

const manifest=JSON.parse(fs.readFileSync(new URL('../qa/artisys-qa.config.json',import.meta.url),'utf8'));

test('PDV legacy QA profiles are empty until E2E flows are rebuilt',()=>{
  for (const name of ['quick','full','release']) {
    const profile=resolveQaProfile(manifest,name);
    assert.equal(profile.flows.length,0);
    assert.equal(profile.includeCrosscut,false);
  }
});

test('renderer health fails on unexpected runtime errors but preserves expected network evidence',async()=>{
  const result=await runRendererHealthContract({
    sweepResult:{
      consoleErrors:[{text:'boom'}],
      pageErrors:[{message:'render crashed'}],
      requestFailures:[
        {url:'http://local.test/expected',expected:true,error:'simulated timeout'},
        {url:'http://local.test/unexpected',error:'net::ERR_FAILED'}
      ],
      httpErrors:[{url:'http://local.test/api',status:500}],
      findings:[{code:'interactive-overlap',severity:'high',selectors:['#save','#cancel']}]
    },
    policy:{blockSeverities:['high','critical']}
  });

  assert.equal(result.checks[0].name,'renderer-health');
  assert.equal(result.checks[0].status,'failed');
  assert.equal(result.consoleErrors.length,1);
  assert.equal(result.networkErrors.find(x=>x.url.endsWith('/expected'))?.expected,true);
  assert.equal(result.networkErrors.find(x=>x.url.endsWith('/unexpected'))?.expected,false);
  assert.equal(result.findings.find(x=>x.code==='interactive-overlap')?.severity,'critical');
});

test('renderer health passes when only expected network failures are present',async()=>{
  const result=await runRendererHealthContract({
    sweepResult:{
      consoleErrors:[],pageErrors:[],httpErrors:[],findings:[],
      requestFailures:[{url:'http://local.test/recovery',expected:true,error:'simulated timeout'}]
    }
  });
  assert.equal(result.checks[0].status,'passed');
  assert.equal(result.networkErrors.length,1);
});

test('profile runner appends injected crosscut checks without rerunning functional flows',async()=>{
  const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-crosscut-profile-'));
  const outputRoot=path.join(rootDir,'qa-artifacts');
  const localManifest={
    systemId:'fixture',mode:'web',defaultEnvironment:'ci',defaultViewport:'desktop',
    environments:{ci:{baseURL:'http://local.test'}},
    viewports:{desktop:{width:100,height:100}},
    flows:{smoke:'flows/smoke.json'},
    qaProfiles:{full:{flows:['smoke'],criticalFlows:['smoke'],includeCrosscut:true}}
  };
  let flowRuns=0;
  let crosscutRuns=0;
  const result=await runQaProfile({
    manifest:localManifest,rootDir,profileName:'full',outputRoot,
    flowRunner:async()=>{flowRuns++;return{outputDir:path.join(outputRoot,'smoke'),summary:{startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()}};},
    crosscutContracts:[{id:'fixture-contract',critical:true,runContract:async()=>({checks:[{name:'fixture-contract',status:'passed',critical:true}]})}],
    crosscutRunner:async options=>{crosscutRuns++; const {runCrosscutContracts}=await import('../qa/runtime/src/crosscut-runner.js'); return runCrosscutContracts(options);}
  });
  assert.equal(flowRuns,1);
  assert.equal(crosscutRuns,1);
  assert.equal(result.results.some(x=>x.check==='crosscut:fixture-contract'&&x.status==='passed'),true);
});

test('profile runner refuses an empty legacy suite instead of reporting a false pass',async()=>{
  const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-empty-qa-profile-'));
  const manifest={systemId:'fixture',mode:'web',defaultEnvironment:'ci',defaultViewport:'desktop',environments:{ci:{baseURL:'http://local.test'}},flows:{},qaProfiles:{full:{flows:[],criticalFlows:[]}}};
  await assert.rejects(()=>runQaProfile({manifest,rootDir,profileName:'full'}),/no active flows/);
});
