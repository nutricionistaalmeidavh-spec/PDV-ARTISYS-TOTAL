'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('../server/local-server');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pdv-e13e20-'));
  let seq = 0;
  const runtime = createPdvRuntime({ dbPath:path.join(dir,'pdv.sqlite'), idFactory:p=>`${p}-${++seq}` });
  runtime.catalog.createUser({id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'});
  const server = createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install-secret'});
  const address = await server.start();
  return { dir, runtime, server, base:`http://${address.host}:${address.port}`, async cleanup(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});} };
}

async function login(base) {
  const response = await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'install-secret'},body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'PDV-01'})});
  assert.equal(response.status,200);
  return (await response.json()).sessionToken;
}
function headers(token){return {authorization:`Bearer ${token}`,'content-type':'application/json'};}

test('runtime exposes E13-E20 operational services',()=>{
  const runtime=createPdvRuntime();
  try {
    for(const key of ['inventory','cash','sales','returns','finance','reports','printing']) assert.ok(runtime[key],key);
  } finally { runtime.close(); }
});

test('authenticated API exposes operational E13-E20 families',async()=>{
  const ctx=await setup();
  try {
    const token=await login(ctx.base);
    for(const endpoint of ['/api/v1/inventory','/api/v1/cash/sessions','/api/v1/sales/history','/api/v1/returns','/api/v1/finance/summary','/api/v1/reports/sales','/api/v1/print/jobs']) {
      const response=await fetch(`${ctx.base}${endpoint}`,{headers:headers(token)});
      assert.equal(response.status,200,endpoint);
    }
    for(const endpoint of ['/api/v1/fiscal/documents','/api/v1/nfse/documents']) {
      const response=await fetch(`${ctx.base}${endpoint}`,{headers:headers(token)});
      assert.equal(response.status,404,endpoint);
    }
    const unauth=await fetch(`${ctx.base}/api/v1/reports/sales`);
    assert.equal(unauth.status,401);
  } finally { await ctx.cleanup(); }
});

test('desktop loads real operational renderers instead of E13-E20 placeholders',()=>{
  const root=path.join(__dirname,'..','desktop','renderer');
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const api=fs.readFileSync(path.join(root,'api-client.js'),'utf8');
  const operational=fs.readFileSync(path.join(root,'operational-pages.js'),'utf8');
  assert.match(index,/operational-pages\.js/);
  for(const name of ['renderInventory','renderCash','renderSalesHistory','renderReturns','renderFinance','renderReports']) assert.match(operational,new RegExp(`function ${name}\\b`));
  for(const method of ['inventoryBalances','cashSessions','salesHistory','returns','financeSummary','reportSales','printJobs']) assert.match(api,new RegExp(`${method}\\s*\\(`));
  assert.doesNotMatch(api,/fiscalDocuments|requestFiscalIssue|retryFiscalIssue/);
  assert.doesNotMatch(operational,/Módulo previsto para E1[3-9]|Módulo previsto para E20/);
});


test('P0 financial UI keeps approved pages intact while hardening risky actions',()=>{
  const root=path.join(__dirname,'..','desktop','renderer');
  const operational=fs.readFileSync(path.join(root,'operational-pages.js'),'utf8');
  const management=fs.readFileSync(path.join(root,'erp-finance-ui.js'),'utf8');
  const operations=fs.readFileSync(path.join(root,'erp-finance-operations-ui.js'),'utf8');
  const start=operational.indexOf('async function renderFinance');
  const end=operational.indexOf('async function renderReports',start);
  const financeSlice=operational.slice(start,end);
  assert.doesNotMatch(financeSlice,/root\.prompt\(/);
  assert.match(financeSlice,/openFormDialog/);
  assert.match(management,/erpDashboard\(\{from,to,basis\}\)/);
  assert.match(management,/equivalentPreviousPeriod/);
  assert.doesNotMatch(management,/setUTCMonth\(previousFrom/);
  assert.match(operations,/\[data-reconcile-reject\]/);
  assert.match(operations,/reviewSuggestion\(button\.dataset\.reconcileAccept,'accept'\)/);
  assert.match(operations,/reviewSuggestion\(button\.dataset\.reconcileReject,'reject'\)/);
  assert.match(operations,/openFormDialog/);
});
