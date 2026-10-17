import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStructuralGeometry } from '../qa/runtime/src/ui-sweep.js';

const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});

function baseSnapshot(){
  return {
    viewport:{width:100,height:100},
    document:{scrollWidth:100,clientWidth:100},
    interactives:[]
  };
}

test('detects horizontal overflow, offscreen interactive controls and missing accessible labels',()=>{
  const snapshot=baseSnapshot();
  snapshot.document.scrollWidth=128;
  snapshot.interactives.push(
    {selector:'#outside',rect:rect(130,10,20,20),visible:true,labelled:true,ancestorSelectors:[],dialogId:null},
    {selector:'#search',rect:rect(10,60,50,20),visible:true,labelled:false,ancestorSelectors:[],dialogId:null}
  );

  const findings=analyzeStructuralGeometry(snapshot);
  assert.ok(findings.some(x=>x.code==='horizontal-overflow'&&x.severity==='high'));
  assert.ok(findings.some(x=>x.code==='interactive-offscreen'&&x.selector==='#outside'&&x.severity==='high'));
  assert.ok(findings.some(x=>x.code==='control-unlabelled'&&x.selector==='#search'&&x.severity==='medium'));
});

test('detects material overlap between independent visible interactive siblings',()=>{
  const snapshot=baseSnapshot();
  snapshot.interactives.push(
    {selector:'#save',rect:rect(10,10,50,30),visible:true,labelled:true,ancestorSelectors:[],dialogId:null},
    {selector:'#cancel',rect:rect(40,15,50,30),visible:true,labelled:true,ancestorSelectors:[],dialogId:null}
  );

  const findings=analyzeStructuralGeometry(snapshot);
  const overlap=findings.find(x=>x.code==='interactive-overlap');
  assert.ok(overlap);
  assert.equal(overlap.severity,'high');
  assert.deepEqual(overlap.selectors,['#save','#cancel']);
});

test('ignores containment and overlap within the same active dialog',()=>{
  const snapshot=baseSnapshot();
  snapshot.interactives.push(
    {selector:'#button',rect:rect(10,10,60,40),visible:true,labelled:true,ancestorSelectors:[],dialogId:null},
    {selector:'#button-icon',rect:rect(20,20,10,10),visible:true,labelled:true,ancestorSelectors:['#button'],dialogId:null},
    {selector:'#dialog-a',rect:rect(15,65,40,25),visible:true,labelled:true,ancestorSelectors:['#dialog'],dialogId:'#dialog'},
    {selector:'#dialog-b',rect:rect(35,65,40,25),visible:true,labelled:true,ancestorSelectors:['#dialog'],dialogId:'#dialog'}
  );

  const findings=analyzeStructuralGeometry(snapshot);
  assert.equal(findings.some(x=>x.code==='interactive-overlap'),false);
});

test('runUiSweep aggregates structural findings returned from each page snapshot',async()=>{
  const {runUiSweep}=await import('../qa/runtime/src/ui-sweep.js');
  const handlers={};
  const page={
    on(type,handler){handlers[type]=handler;},
    async goto(){return{status:()=>200};},
    url(){return 'http://local.test/';},
    async evaluate(){
      return {
        title:'Home',links:[],buttons:[],forms:[],controls:[],
        structuralSnapshot:{
          viewport:{width:100,height:100},
          document:{scrollWidth:120,clientWidth:100},
          interactives:[]
        }
      };
    }
  };
  const result=await runUiSweep({page,baseURL:'http://local.test/',maxPages:1});
  assert.ok(result.findings.some(x=>x.code==='horizontal-overflow'));
  assert.ok(result.pages[0].structuralFindings.some(x=>x.code==='horizontal-overflow'));
});
