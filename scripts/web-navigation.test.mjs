import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url);
const load=file=>{const module={exports:{}};runInNewContext(readFileSync(new URL('../apps/web/'+file,import.meta.url),'utf8'),{module});return module.exports;};
const navigation=load('web-navigation.js'),policy=load('access-policy.js');
const {DEFAULT_PROFILE_PERMISSIONS}=require('../packages/core/js/core/auth/default-profiles.js');
const user=profileKey=>({profileKey,permissions:DEFAULT_PROFILE_PERMISSIONS[profileKey==='OWNER'?'ADMINISTRATOR':profileKey]||[]});

test('hosted navigation retains desktop hubs and permits their child destinations according to business permissions',()=>{
  const owner=user('OWNER'),options={moduleState:{FOOD:true,WHOLESALE:true}};
  assert.deepEqual(Array.from(navigation.sidebar(owner,policy,options)),Array.from(policy.TOP_LEVEL_ROUTES).filter(route=>route!=='settings'));
  for(const route of ['catalog','post-sale','financial-management','access','returns','suppliers','credit','commissions'])
    assert.equal(navigation.canAccess(owner,route,policy,options),true,route);
  assert.equal(navigation.parent('returns'),'post-sale');assert.equal(navigation.parent('suppliers'),'catalog');
});
test('hosted route checks reject anonymous, unknown and unauthorized access and respect explicitly disabled areas',()=>{
  assert.equal(navigation.sidebar(null,policy).length,0);
  assert.equal(navigation.canAccess(user('CASHIER'),'saas-admin',policy),false);
  assert.equal(navigation.canAccess(user('CASHIER'),'inventory',policy),false);
  assert.equal(navigation.canAccess(user('CASHIER'),'access',policy),true,'staff can reach only their own account sessions');
  assert.equal(navigation.canAccess(user('OWNER'),'unknown',policy),false);
  assert.equal(navigation.canAccess(user('OWNER'),'WHOLESALE',policy,{moduleState:{WHOLESALE:false}}),false);
});
test('application HTML loads navigation, settings and master-register modules before their consumers',()=>{
  const html=readFileSync(new URL('../apps/web/index.html',import.meta.url),'utf8');
  for(const file of ['web-navigation.js','web-settings-ui.js','web-catalog-master.js']){
    assert.ok(html.indexOf('./'+file)<html.indexOf('./app.js'));
    assert.ok(existsSync(resolve('apps/web',file)));
  }
});

test('a delayed checkout restore cannot render or steal focus after navigation to reports',async()=>{
  const source=readFileSync(new URL('../apps/web/app.js',import.meta.url),'utf8');
  const navigationSource=source.slice(source.indexOf('  let navigationGeneration=0;'),source.indexOf('  async function renderRoute()'));
  let finishRestore;const pending=new Promise(resolve=>{finishRestore=resolve;});
  const state={route:'home',user:{id:'test'},config:{}};
  const renders=[],focus=[],events=[];
  const navigate=runInNewContext(navigationSource+';navigate',{
    ROUTES:{home:{},checkout:{},reports:{}},state,canAccessRoute:()=>true,
    document:{body:{dataset:{},classList:{toggle(){}}}},renderSidebar(){},
    restoreCheckoutState:()=>pending,showToast(){},
    renderRoute:async()=>renders.push(state.route),api:{webMode:true},
    content:{focus:()=>focus.push(state.route),querySelector:()=>({focus:()=>focus.push('report-tab')})},
    window:{PdvUiLifecycle:{emit:(_event,detail)=>events.push(detail.route)}}
  });
  const checkout=navigate('checkout');
  await navigate('reports');
  finishRestore();await checkout;
  assert.deepEqual(renders,['reports']);
  assert.deepEqual(focus,['reports','report-tab']);
  assert.deepEqual(events,['reports']);
});
