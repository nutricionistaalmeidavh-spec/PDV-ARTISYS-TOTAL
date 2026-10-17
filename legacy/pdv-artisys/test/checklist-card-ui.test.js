'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');

test('preparation is a closed card, opens by keyboard and collapses after completion',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.setContent('<body data-active-route="settings"><div id="route-content"><div class="ops-page"><div class="ops-head"><h1>Configurações</h1></div></div></div><div id="toast-root"></div></body>');
 await page.evaluate(()=>{
  const state={ready:false,status:'IN_PROGRESS',total:1,readyCount:0,blockedCount:0,externalBlockedCount:0};
  class ApiClient{
   async initialize(){return {storeName:'Loja',terminalId:'PDV-01'};}
   async systemHealth(){return {};}
   async backupStatus(){return {};}
   async backups(){return [];}
   async settings(){return [];}
   async pilotChecks(){return [{key:'scale-test',title:'Balança',category:'hardware',optional:true,status:state.ready?'READY':'NOT_STARTED'}];}
   async pilotReadiness(){return {...state};}
   async systemLogs(){return [];}
   async audit(){return [];}
   async updatePilotCheck(){state.ready=true;state.status='READY';state.readyCount=1;}
  }
  window.PdvApiClient={ApiClient};window.PdvUiLifecycle={on(){}};window.PdvRouteRegistry={updated(){}};
 });
 await page.addScriptTag({path:path.resolve(__dirname,'../desktop/renderer/admin-ops.js')});
 const card=page.locator('#ops-pilot-checklist');await card.waitFor();
 assert.equal(await card.getAttribute('data-settings-category'),'diagnostics');
 assert.equal(await card.evaluate(el=>el.open),false);
 assert.equal(await card.locator('table').isVisible(),false);
 await card.locator('summary').focus();await page.keyboard.press('Enter');
 assert.equal(await card.locator('table').isVisible(),true);
 await card.locator('[data-pilot-status]').selectOption('READY');
 await page.waitForFunction(()=>document.querySelector('#ops-pilot-checklist')?.textContent.includes('Preparação concluída'));
 assert.equal(await page.locator('#ops-pilot-checklist').evaluate(el=>el.open),false);
 assert.equal(await page.locator('#ops-pilot-checklist table').isVisible(),false);
 await page.locator('#ops-pilot-checklist summary').click();
 assert.equal(await page.locator('#ops-pilot-checklist table').isVisible(),true);
});
