'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve('.');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('P1-P3 tutorial catalog and demos cover the 24 planned tutorials',()=>{
  const catalog=readJson('qa/tutorials/catalog.json');
  const expected={P1:9,P2:7,P3:8};
  const tutorials=catalog.tutorials.filter(item=>expected[item.phase]);
  assert.equal(tutorials.length,24);
  for(const [phase,count] of Object.entries(expected)){
    assert.equal(tutorials.filter(item=>item.phase===phase).length,count,phase);
  }

  const config=readJson('qa/artisys-qa.config.json');
  for(const tutorial of tutorials){
    const demo=config.demos?.[tutorial.id];
    assert.ok(demo, tutorial.id);
    assert.equal(demo.durationTargetSec,tutorial.durationTargetSec,tutorial.id);
    assert.equal(demo.profile,'tutorials-p1-p3',tutorial.id);
    const flow=readJson(path.join('qa',demo.file));
    assert.equal(flow.metadata?.qaAutoAdmin,true,tutorial.id);
    assert.equal(flow.steps[0]?.action,'authenticateLocalQa',tutorial.id);
    assert.ok(flow.steps.some(step=>step.name==='app-ready'),tutorial.id);
    assert.ok(flow.steps.some(step=>step.action==='expectVisible'||step.action==='expectText'||step.action==='expectValue'),tutorial.id);
  }
});

test('P1-P3 capture workflow records, edits and publishes every tutorial MP4',()=>{
  const workflow=readText('.github/workflows/tutorial-capture-p1-p3.yml');
  const catalog=readJson('qa/tutorials/catalog.json');
  const tutorials=catalog.tutorials.filter(item=>['P1','P2','P3'].includes(item.phase));
  for(const tutorial of tutorials)assert.ok(workflow.includes(tutorial.id),tutorial.id);
  assert.match(workflow,/artisys-qa\.mjs demo/);
  assert.match(workflow,/--profile tutorials-p1-p3/);
  assert.match(workflow,/qa:tutorials:edit/);
  assert.match(workflow,/actions\/upload-artifact@v4/);
});

test('tutorial output contract keeps all P1-P3 videos at or below 30 seconds',()=>{
  const catalog=readJson('qa/tutorials/catalog.json');
  for(const item of catalog.tutorials.filter(item=>['P1','P2','P3'].includes(item.phase))){
    assert.ok(item.durationTargetSec<=30,item.id);
    assert.match(item.outputFile,/\.mp4$/);
    assert.ok(Array.isArray(item.overlays)&&item.overlays.length>=2,item.id);
  }
});

test('terminal pairing tutorial waits for terminal panel before selecting the settings category',()=>{
  const flow=readJson('qa/demo/tutorials/31-parear-terminal.json');
  const attached=flow.steps.findIndex(step=>step.name==='terminal-panel-attached'&&step.action==='waitFor'&&step.state==='attached');
  const category=flow.steps.findIndex(step=>step.name==='abrir-unidades');
  assert.ok(attached>=0,'missing attached wait for terminal panel');
  assert.ok(category>attached,'units category must be selected only after terminal panel mounts');
});
