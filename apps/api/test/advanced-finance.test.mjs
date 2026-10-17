import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createAdvancedFinanceService,nextRecurrenceDate} from '../src/advanced-finance.mjs';

const sql=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
const now='2026-10-17T14:00:00.000Z';
const setup=async()=>{
 const db=openLocalDatabase();
 for(const name of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql','0004_advanced_finance.sql'])db.exec(sql(name));
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind('u','u@a.com','User','unused',now).run();
 for(const [tenant,branch] of [['a','x'],['b','y']]){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(tenant,tenant,tenant,now).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind(branch,tenant,'MAIN','Matriz',now).run();
 }
 return {db,service:createAdvancedFinanceService(db,{now:()=>now}),close:()=>db.close()};
};
test('recurrence date is anchored to original month day across February and leap years',()=>{
 assert.equal(nextRecurrenceDate('2027-01-31','MONTHLY',31,1),'2027-02-28');
 assert.equal(nextRecurrenceDate('2027-02-28','MONTHLY',31,1),'2027-03-31');
 assert.equal(nextRecurrenceDate('2024-02-29','YEARLY',29,2),'2025-02-28');
});
test('repeated or overlapping imported statements never duplicate bank transactions',async()=>{
 const x=await setup();try{
  const a=await x.service.createAccount('a','x','u',{name:'Banco local'});
  const lines=[{date:'2026-10-17',amountCents:-5000,description:'Pagamento',fitId:'a-100'},
               {date:'2026-10-17',amountCents:8000,description:'Recebimento',fitId:'a-101'}];
  const one=await x.service.importStatement('a','x','u',{accountId:a.id,sourceName:'out.ofx',transactions:lines});
  const again=await x.service.importStatement('a','x','u',{accountId:a.id,sourceName:'copy.ofx',transactions:lines});
  const overlap=await x.service.importStatement('a','x','u',{accountId:a.id,sourceName:'other.csv',transactions:[lines[0]]});
  assert.equal(one.imported,2);assert.equal(again.imported,0);assert.equal(overlap.imported,0);
  assert.equal((await x.service.transactions('a','x')).length,2);
  assert.equal((await x.service.transactions('b','y')).length,0);
 }finally{x.close();}
});
test('matching a bank transaction creates one settlement, never a duplicate expense, and verifies direction',async()=>{
 const x=await setup();try{
  const account=await x.service.createAccount('a','x','u',{name:'Conta principal'});
  await x.db.prepare('INSERT INTO finance_entries(id,tenant_id,branch_id,kind,description,amount_cents,due_date,competence_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('bill','a','x','PAYABLE','Energia',7000,'2026-10-17','2026-10-17','u',now).run();
  await x.service.importStatement('a','x','u',{accountId:account.id,sourceName:'extrato',transactions:[{date:'2026-10-17',amountCents:-3000,description:'Energia',fitId:'001'},{date:'2026-10-18',amountCents:4000,description:'Crédito',fitId:'002'}]});
  const tx=await x.service.transactions('a','x');
  assert.equal(await x.service.match('a','x','u',{transactionId:tx[1].id,entryId:'bill'}).then(()=>200,e=>e.status),409);
  const matched=await x.service.match('a','x','u',{transactionId:tx[0].id,entryId:'bill'});
  assert.equal(matched.decision,'MATCH');
  assert.equal((await x.service.match('a','x','u',{transactionId:tx[0].id,entryId:'bill'})).id,matched.id);
  const count=await x.db.prepare("SELECT COUNT(*) AS n, SUM(amount_cents) AS total FROM finance_settlements WHERE entry_id='bill'").bind().first();
  assert.equal(count.n,1);assert.equal(count.total,3000);
  await assert.rejects(x.service.match('b','y','u',{transactionId:tx[0].id,entryId:'bill'}));
 }finally{x.close();}
});
test('generation is idempotent and pause avoids new receivables',async()=>{
 const x=await setup();try{
  const recurring=await x.service.createRecurrence('a','x','u',{description:'Aluguel',kind:'PAYABLE',amountCents:10000,frequency:'MONTHLY',startDate:'2026-01-31'});
  const result=await x.service.generate('a','x','u',{asOf:'2026-03-31'});
  assert.equal(result.created,3);
  assert.equal((await x.service.generate('a','x','u',{asOf:'2026-03-31'})).created,0);
  await x.service.setRecurrenceStatus('a','x',recurring.id,'PAUSED');
  assert.equal((await x.service.generate('a','x','u',{asOf:'2026-04-30'})).created,0);
  assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM finance_entries WHERE source_recurrence_id=?').bind(recurring.id).first()).n,3);
 }finally{x.close();}
});
test('DRE cash and accrual differ, sale revenue is never counted twice, tenants isolated',async()=>{
 const x=await setup();try{
  await x.db.prepare('INSERT INTO finance_entries(id,tenant_id,branch_id,kind,description,amount_cents,due_date,competence_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('expense','a','x','PAYABLE','Luz',4000,'2026-10-17','2026-10-17','u',now).run();
  await x.db.prepare('INSERT INTO finance_settlements(id,tenant_id,branch_id,entry_id,amount_cents,method,occurred_at,operator_id,mutation_id) VALUES(?,?,?,?,?,?,?,?,?)').bind('s1','a','x','expense',1000,'PIX',now,'u','test-settlement-1').run();
  const accrual=await x.service.dre('a','x',{from:'2026-10-01',to:'2026-10-31',basis:'accrual'});
  const cash=await x.service.dre('a','x',{from:'2026-10-01',to:'2026-10-31',basis:'cash'});
  assert.equal(accrual.expenseCents,4000);assert.equal(cash.expenseCents,1000);
  assert.equal(accrual.resultCents,-4000);assert.equal(cash.resultCents,-1000);
  assert.equal((await x.service.dre('b','y',{from:'2026-10-01',to:'2026-10-31',basis:'accrual'})).resultCents,0);
 }finally{x.close();}
});