import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://advanced-finance.test',time='2026-10-17T14:00:00.000Z';
async function setup(){
 const db=openLocalDatabase();
 for(const name of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql','0004_advanced_finance.sql','0005_vertical_parity.sql','0006_desktop_parity.sql','0007_stock_transfers.sql','0008_transaction_reversals.sql','0009_catalog_inventory.sql','0010_purchase_orders.sql','0011_product_media.sql','0012_sale_item_notes.sql','0013_cash_terminals.sql','0014_checkout_configurations.sql','0015_seller_sales_targets.sql','0016_inventory_lot_receipts.sql','0017_inventory_minimum_levels.sql','0018_inventory_lot_balances.sql','0020_sale_configured_lines.sql','0038_product_menu_usage.sql','0039_p4_finance_operations.sql'])
  db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const password='CorrectHorseBattery2026!';
 const hash=await hashPassword(password);
 for(const u of ['owner','viewer','other']){
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind(u,u+'@test.com',u,hash,time).run();
 }
 for(const [tenant,branch] of [['a','branch-a'],['b','branch-b']]){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
   .bind(tenant,'shop-'+tenant,'Store '+tenant,time).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
   .bind(branch,tenant,'MAIN','Matriz',time).run();
 }
 for(const [tenant,user,role] of [['a','owner','OWNER'],['a','viewer','READ_ONLY'],['b','other','OWNER']])
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
   .bind(tenant,user,role,time).run();
 const api=createApi({DB:db,AUTH_ENABLED:'true'},{now:()=>Date.parse(time)});
 async function call(path,{cookie='',body,method='GET',originHeader=true}={}){
  const headers={};if(cookie)headers.cookie=cookie;
  if(method!=='GET'&&originHeader)headers.origin=origin;
  if(body!==undefined)headers['content-type']='application/json';
  const response=await api.fetch(new Request(origin+path,{method,headers,
   ...(body!==undefined?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
 }
 const login=async(user)=>(await call('/api/v1/auth/login',{method:'POST',body:{email:user+'@test.com',password}})).cookie;
 return {db,call,login,close:()=>db.close()};
}
test('advanced finance API enforces session, membership, branch and role before D1 mutations',async()=>{
 const s=await setup();try{
  const owner=await s.login('owner'),viewer=await s.login('viewer'),other=await s.login('other');
  const path='/api/v1/tenants/a/finance-advanced/accounts';
  assert.equal((await s.call(path+'?branchId=branch-a')).status,401);
  assert.equal((await s.call(path+'?branchId=branch-a',{cookie:viewer})).status,200);
  assert.equal((await s.call(path,{cookie:viewer,method:'POST',body:{branchId:'branch-a',name:'Meu banco'}})).status,403);
  assert.equal((await s.call(path,{cookie:other,method:'POST',body:{branchId:'branch-a',name:'Meu banco'}})).status,404);
  assert.equal((await s.call(path,{cookie:owner,method:'POST',originHeader:false,body:{branchId:'branch-a',name:'Meu banco'}})).status,403);
  assert.equal((await s.call(path,{cookie:owner,method:'POST',body:{branchId:'branch-b',name:'Meu banco'}})).status,404);
  const result=await s.call(path,{cookie:owner,method:'POST',body:{branchId:'branch-a',name:'Meu banco'}});
  assert.equal(result.status,201,result.data.error);
  const accounts=await s.call(path+'?branchId=branch-a',{cookie:owner});
  assert.equal(accounts.data.accounts.length,1);assert.equal(accounts.data.accounts[0].id,result.data.account.id);
  assert.equal((await s.call('/api/v1/tenants/b/finance-advanced/accounts?branchId=branch-b',{cookie:other})).data.accounts.length,0);
 }finally{s.close();}
});
test('advanced finance HTTP route generates recurring payable and reports canonical accrual expenses',async()=>{
 const s=await setup();try{
  const owner=await s.login('owner');
  const base='/api/v1/tenants/a/finance-advanced/';
  const write=(path,body)=>s.call(base+path,{cookie:owner,method:'POST',body:{branchId:'branch-a',...body}});
  const rule=await write('recurrences',{description:'Aluguel mensal',kind:'PAYABLE',amountCents:9500,frequency:'MONTHLY',startDate:'2026-10-17'});
  assert.equal(rule.status,201,rule.data.error);
  const generated=await write('recurrences/generate',{asOf:'2026-10-17'});
  assert.equal(generated.status,200,generated.data.error);
  assert.equal(generated.data.result.created,1);
  const again=await write('recurrences/generate',{asOf:'2026-10-17'});
  assert.equal(again.data.result.created,0);
  const dre=await s.call(base+'dre?branchId=branch-a&from=2026-10-01&to=2026-10-31&basis=accrual',{cookie:owner});
  assert.equal(dre.status,200,dre.data.error);
  assert.equal(dre.data.dre.expenseCents,9500);
  const cashflow=await s.call(base+'dre/cashflow?branchId=branch-a&from=2026-10-01&to=2026-10-31',{cookie:owner});
  assert.equal(cashflow.status,200,cashflow.data.error);
  assert.equal(cashflow.data.cashflow.projectedPayableCents,9500);
 }finally{s.close();}
});
test('P4 HTTP: wallet roles, date alerts, filtered bank history and matching lookup are tenant scoped',async()=>{
 const s=await setup();try{
  const owner=await s.login('owner'),viewer=await s.login('viewer'),other=await s.login('other');
  const base='/api/v1/tenants/a/finance-advanced/';
  const get=(path,cookie=owner)=>s.call(base+path+'?branchId=branch-a',{cookie});
  const wallet=await s.call(base+'accounts',{cookie:owner,method:'POST',body:{branchId:'branch-a',name:'Caixa físico',walletKind:'CASH'}});
  assert.equal(wallet.status,201,wallet.data.error);
  assert.equal(wallet.data.account.walletKind,'CASH');
  const accounts=await get('accounts');
  assert.equal(accounts.data.accounts[0].walletKind,'CASH');
  assert.equal((await get('due?asOf=2026-10-17',viewer)).status,200);
  const due=await get('due?unused=1&asOf=2026-10-17');
  assert.equal(due.status,200,due.data.error);
  assert.equal(due.data.due.totals.overdueCents,0);
  const alerts=await get('recurrences/alerts?asOf=2026-10-17');
  assert.equal(alerts.status,200,alerts.data.error);
  assert.equal(alerts.data.alerts.items.length,0);
  const tx=await get('transactions?status=UNMATCHED&direction=OUT&from=2026-10-01&to=2026-10-31');
  assert.equal(tx.status,200,tx.data.error);
  assert.deepEqual(tx.data.transactions,[]);
  assert.equal((await get('transactions?direction=INVALID')).status,400);
  assert.equal((await get('due?asOf=2026-10-17&horizonDays=500')).status,400);
  assert.equal((await s.call(base+'due?branchId=branch-b&asOf=2026-10-17',{cookie:owner})).status,404);
  assert.equal((await s.call(base+'due?branchId=branch-a&asOf=2026-10-17',{cookie:other})).status,404);
  assert.equal((await s.call(base+'recurrences/alerts?branchId=branch-a&asOf=2026-10-17',{cookie:other})).status,404);
  assert.equal((await s.call(base+'settlement-suggestions/missing?branchId=branch-a',{cookie:owner})).status,404);
  assert.equal((await s.call(base+'accounts',{cookie:viewer,method:'POST',body:{branchId:'branch-a',name:'Denegado',walletKind:'BANK'}})).status,403);
 }finally{s.close();}
});
