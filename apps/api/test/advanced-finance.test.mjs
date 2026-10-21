import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createAdvancedFinanceService,nextRecurrenceDate} from '../src/advanced-finance.mjs';

const sql=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
const now='2026-10-17T14:00:00.000Z';
const setup=async()=>{
 const db=openLocalDatabase();
 for(const name of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql','0004_advanced_finance.sql','0005_vertical_parity.sql','0006_desktop_parity.sql','0007_stock_transfers.sql','0008_transaction_reversals.sql','0009_catalog_inventory.sql','0010_purchase_orders.sql','0011_product_media.sql','0012_sale_item_notes.sql','0013_cash_terminals.sql','0014_checkout_configurations.sql','0015_seller_sales_targets.sql','0016_inventory_lot_receipts.sql','0017_inventory_minimum_levels.sql','0018_inventory_lot_balances.sql','0020_sale_configured_lines.sql','0039_p4_finance_operations.sql','0040_wallet_operations.sql','0042_finance_query_indexes.sql'])db.exec(sql(name));
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind('u','u@a.com','User','unused',now).run();
 for(const [tenant,branch] of [['a','x'],['b','y']]){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(tenant,'shop-'+tenant,tenant,now).run();
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
test('finance categories and cost centers classify the canonical account, and future cashflow retains open debt',async()=>{
 const x=await setup();try{
  await x.db.prepare('INSERT INTO finance_entries(id,tenant_id,branch_id,kind,description,amount_cents,due_date,competence_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind('water','a','x','PAYABLE','Água',5600,'2026-11-17','2026-11-17','u',now).run();
  const group=await x.service.createGroup('a','x',{name:'Despesas operacionais',nature:'COST'});
  const center=await x.service.createCostCenter('a','x',{name:'Filial matriz'});
  const category=await x.service.createCategory('a','x',{name:'Contas de consumo',kind:'EXPENSE',dreGroupId:group.id});
  const applied=await x.service.classify('a','x','water',{categoryId:category.id,costCenterId:center.id});
  assert.equal(applied.dreGroupId,group.id);
  const report=await x.service.dre('a','x',{from:'2026-11-01',to:'2026-11-30',basis:'accrual'});
  assert.equal(report.costCents,5600);assert.equal(report.expenseCents,0);
  assert.equal(report.groups[0].costCenterId,center.id);
  const flow=await x.service.cashflow('a','x',{from:'2026-11-01',to:'2026-11-30'});
  assert.equal(flow.projectedPayableCents,5600);
  assert.equal(flow.projectedClosingDeltaCents,-5600);
  await assert.rejects(x.service.classify('b','y','water',{categoryId:category.id}),error=>error.status===404);
 }finally{x.close();}
});
test('internal bank transfers only pair opposite transactions across distinct accounts, never affect DRE',async()=>{
 const x=await setup();try{
  const a=await x.service.createAccount('a','x','u',{name:'Banco um'});
  const b=await x.service.createAccount('a','x','u',{name:'Banco dois'});
  await x.service.importStatement('a','x','u',{accountId:a.id,sourceName:'bank-a',transactions:[{date:'2026-10-17',amountCents:-7000,description:'TED',fitId:'ted-a'}]});
  await x.service.importStatement('a','x','u',{accountId:b.id,sourceName:'bank-b',transactions:[{date:'2026-10-17',amountCents:7000,description:'TED',fitId:'ted-b'}]});
  const proposals=await x.service.transferSuggestions('a','x');
  assert.equal(proposals.length,1);
  assert.equal((await x.service.confirmTransfer('a','x','u',proposals[0])).confirmed,true);
  assert.equal((await x.service.transferSuggestions('a','x')).length,0);
  assert.equal((await x.service.dre('a','x',{from:'2026-10-01',to:'2026-10-31',basis:'cash'})).resultCents,0);
 }finally{x.close();}
});

test('P4: typed wallets do not manufacture balances; only bank wallets import statements',async()=>{
 const x=await setup();try{
  const bank=await x.service.createAccount('a','x','u',{name:'Banco digital',walletKind:'BANK'});
  const cash=await x.service.createAccount('a','x','u',{name:'Dinheiro em mãos',walletKind:'CASH'});
  const other=await x.service.createAccount('a','x','u',{name:'Carteira secundária',walletKind:'OTHER'});
  assert.equal((await x.service.accounts('a','x')).length,3);
  assert.equal((await x.service.accounts('b','y')).length,0);
  assert.equal(await x.service.createAccount('a','x','u',{name:'Inadequada',walletKind:'CRYPTO'}).then(()=>200,e=>e.status),400);
  assert.equal(await x.service.importStatement('a','x','u',{accountId:cash.id,transactions:[{date:'2026-10-17',amountCents:1200,description:'Manual'}]}).then(()=>200,e=>e.status),409);
  assert.equal(await x.service.importStatement('a','x','u',{accountId:other.id,transactions:[{date:'2026-10-17',amountCents:1200,description:'Manual'}]}).then(()=>200,e=>e.status),409);
  await x.service.importStatement('a','x','u',{accountId:bank.id,transactions:[{date:'2026-10-17',amountCents:10000,description:'Entrada'},{date:'2026-10-17',amountCents:-2000,description:'Taxa'}]});
  const accounts=await x.service.accounts('a','x');
  assert.equal(accounts.find(a=>a.id===bank.id).importedNetCents,8000);
  assert.equal(accounts.find(a=>a.id===cash.id).importedNetCents,0);
  assert.equal(accounts.find(a=>a.id===bank.id).importedMovements,2);
 }finally{x.close();}
});

test('P4: bank search filters date, direction, description, reconciliation, account and rejects invalid inputs',async()=>{
 const x=await setup();try{
  const account=await x.service.createAccount('a','x','u',{name:'Conta filtro'});
  await x.service.importStatement('a','x','u',{accountId:account.id,transactions:[
   {date:'2026-10-12',amountCents:-2500,description:'Fornecedor Azul',fitId:'F-AZ'},
   {date:'2026-10-16',amountCents:6800,description:'Cliente Verde',fitId:'F-VD'},
   {date:'2026-10-17',amountCents:-1100,description:'Tarifa bancária',fitId:'F-TX'}
  ]});
  const debit=await x.service.transactions('a','x',{direction:'OUT',from:'2026-10-16'});
  assert.equal(debit.length,1);assert.equal(debit[0].description,'Tarifa bancária');
  assert.equal((await x.service.transactions('a','x',{query:'verde',direction:'IN'})).length,1);
  assert.equal((await x.service.transactions('a','x',{query:'f-az'})).length,1);
  assert.equal((await x.service.transactions('a','x',{accountId:account.id,from:'2026-10-12',to:'2026-10-12'})).length,1);
  assert.equal((await x.service.transactions('a','x',{limit:1})).length,1);
  assert.equal((await x.service.transactions('a','x',{limit:1,offset:1})).length,1);
  assert.equal((await x.service.transactions('b','y')).length,0);
  for(const filter of [{from:'2026-10-18',to:'2026-10-17'},{direction:'SIDEWAYS'},{status:'BAD'},{limit:-5},{offset:99999}]){
   assert.equal(await x.service.transactions('a','x',filter).then(()=>200,e=>e.status),400);
  }
  assert.equal(await x.service.transactions('b','y',{accountId:account.id}).then(()=>200,e=>e.status),404);
 }finally{x.close();}
});

test('P4: real due balances respect partial settlement, reversed settlement, cancellation and tenant separation',async()=>{
 const x=await setup();try{
  const add=async(id,kind,amountCents,dueDate,cancelled=false)=>
   x.db.prepare('INSERT INTO finance_entries(id,tenant_id,branch_id,kind,description,amount_cents,due_date,competence_date,created_by,created_at,cancelled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id,'a','x',kind,id,amountCents,dueDate,dueDate,'u',now,cancelled?now:null).run();
  await add('late','PAYABLE',10000,'2026-10-10');
  await add('today','RECEIVABLE',4000,'2026-10-17');
  await add('near','PAYABLE',3000,'2026-10-22');
  await add('paid','PAYABLE',3000,'2026-10-01');
  await add('cancelled','PAYABLE',3000,'2026-10-01',true);
  const pay=async(id,entry,amount)=>
   x.db.prepare('INSERT INTO finance_settlements(id,tenant_id,branch_id,entry_id,amount_cents,method,occurred_at,operator_id,mutation_id) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id,'a','x',entry,amount,'PIX',now,'u','p4-'+id).run();
  await pay('s-late','late',3000);
  await pay('s-today','today',4000);
  await pay('s-paid','paid',3000);
  await x.db.prepare('INSERT INTO finance_settlement_reversals(id,tenant_id,branch_id,entry_id,settlement_id,amount_cents,operator_id,reason,mutation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind('rv-today','a','x','today','s-today',4000,'u','Teste de estorno','r-p4-today',now).run();
  const due=await x.service.dueOverview('a','x',{asOf:'2026-10-17',horizonDays:7});
  assert.equal(due.totals.overdueCents,7000);
  assert.equal(due.totals.todayCents,4000);
  assert.equal(due.totals.upcomingCents,3000);
  assert.deepEqual(due.items.map(x=>x.id),['late','today','near']);
  assert.equal((await x.service.dueOverview('b','y',{asOf:'2026-10-17'})).items.length,0);
  assert.equal(await x.service.dueOverview('a','x',{asOf:'2026-10-17',horizonDays:100}).then(()=>200,e=>e.status),400);
 }finally{x.close();}
});

test('P4: match existing canonical settlement without duplication, and alert on active recurring dues only',async()=>{
 const x=await setup();try{
  const account=await x.service.createAccount('a','x','u',{name:'Conciliação'});
  await x.db.prepare('INSERT INTO finance_entries(id,tenant_id,branch_id,kind,description,amount_cents,due_date,competence_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind('bill-p4','a','x','PAYABLE','Internet',5000,'2026-10-17','2026-10-17','u',now).run();
  await x.db.prepare('INSERT INTO finance_settlements(id,tenant_id,branch_id,entry_id,amount_cents,method,occurred_at,operator_id,mutation_id) VALUES(?,?,?,?,?,?,?,?,?)')
   .bind('existing-p4','a','x','bill-p4',5000,'PIX',now,'u','p4-received').run();
  await x.service.importStatement('a','x','u',{accountId:account.id,transactions:[{date:'2026-10-17',amountCents:-5000,description:'Internet',fitId:'p4-internet'}]});
  const tx=(await x.service.transactions('a','x'))[0];
  const options=await x.service.settlementSuggestions('a','x',tx.id);
  assert.equal(options.length,1);assert.equal(options[0].id,'existing-p4');
  await x.service.linkSettlement('a','x','u',{transactionId:tx.id,settlementId:'existing-p4'});
  assert.equal((await x.service.settlementSuggestions('a','x',tx.id)).length,0);
  const settled=await x.db.prepare('SELECT COUNT(*) AS n FROM finance_settlements WHERE entry_id=?').bind('bill-p4').first();
  assert.equal(settled.n,1);
  assert.equal(await x.service.settlementSuggestions('b','y',tx.id).then(()=>200,e=>e.status),404);
  const overdue=await x.service.createRecurrence('a','x','u',{description:'Internet mensal',kind:'PAYABLE',amountCents:5000,frequency:'MONTHLY',startDate:'2026-10-14'});
  const upcoming=await x.service.createRecurrence('a','x','u',{description:'Licença trimestral',kind:'PAYABLE',amountCents:1900,frequency:'MONTHLY',startDate:'2026-10-23'});
  const paused=await x.service.createRecurrence('a','x','u',{description:'Pausada',kind:'PAYABLE',amountCents:1200,frequency:'MONTHLY',startDate:'2026-10-17'});
  await x.service.setRecurrenceStatus('a','x',paused.id,'PAUSED');
  const alerts=await x.service.recurrenceAlerts('a','x',{asOf:'2026-10-17',horizonDays:7});
  assert.equal(alerts.items.length,2);
  assert.equal(alerts.items.find(r=>r.id===overdue.id).severity,'OVERDUE');
  assert.equal(alerts.items.find(r=>r.id===upcoming.id).severity,'UPCOMING');
  assert.equal((await x.service.recurrenceAlerts('b','y',{asOf:'2026-10-17'})).items.length,0);
  assert.equal(await x.service.recurrenceAlerts('a','x',{asOf:'2026-10-17',horizonDays:61}).then(()=>200,e=>e.status),400);
 }finally{x.close();}
});


test('P0 wallets: immutable audited balances, no overdraft, atomic transfer, replay and tenant isolation',async()=>{
 const x=await setup();try{
  const source=await x.service.createAccount('a','x','u',{name:'Cofre local',walletKind:'CASH'});
  const destination=await x.service.createAccount('a','x','u',{name:'Carteira auxiliar',walletKind:'OTHER'});
  const bank=await x.service.createAccount('a','x','u',{name:'Banco extratos',walletKind:'BANK'});
  const open=await x.service.walletAdjust('a','x','u',{accountId:source.id,kind:'OPENING',
   amountCents:10000,reason:'Contagem inicial de dinheiro',mutationId:'wallet-p0-opening'});
  assert.equal(open.amountCents,10000);
  assert.equal((await x.service.walletAdjust('a','x','u',{accountId:source.id,kind:'OPENING',
   amountCents:10000,reason:'Contagem inicial de dinheiro',mutationId:'wallet-p0-opening'})).idempotent,true);
  assert.equal(await x.service.walletAdjust('a','x','u',{accountId:source.id,kind:'OPENING',
   amountCents:400,reason:'Outro saldo inicial',mutationId:'wallet-p0-reopen'}).then(()=>200,e=>e.status),409);
  assert.equal(await x.service.walletAdjust('a','x','u',{accountId:source.id,kind:'DEBIT',
   amountCents:11000,reason:'Retirada inválida',mutationId:'wallet-p0-overdraw'}).then(()=>200,e=>e.status),409);
  assert.equal(await x.service.walletAdjust('a','x','u',{accountId:bank.id,kind:'CREDIT',
   amountCents:100,reason:'Não permitido',mutationId:'wallet-p0-bank'}).then(()=>200,e=>e.status),409);
  assert.equal(await x.service.walletAdjust('b','y','u',{accountId:source.id,kind:'CREDIT',
   amountCents:100,reason:'Outra empresa',mutationId:'wallet-p0-cross'}).then(()=>200,e=>e.status),404);
  assert.equal(await x.service.walletTransfer('a','x','u',{fromAccountId:source.id,toAccountId:destination.id,
   amountCents:11000,reason:'Sem fundos para transferir',mutationId:'wallet-p0-overtransfer'}).then(()=>200,e=>e.status),409);
  const args={fromAccountId:source.id,toAccountId:destination.id,amountCents:3000,
   reason:'Remanejamento conferido',mutationId:'wallet-p0-transfer'};
  assert.equal((await x.service.walletTransfer('a','x','u',args)).amountCents,3000);
  assert.equal((await x.service.walletTransfer('a','x','u',args)).idempotent,true);
  assert.equal(await x.service.walletTransfer('a','x','u',{...args,amountCents:2000}).then(()=>200,e=>e.status),409);
  await x.service.walletAdjust('a','x','u',{accountId:destination.id,kind:'DEBIT',
   amountCents:1000,reason:'Compra conferida fora do PDV',mutationId:'wallet-p0-spent'});
  const list=await x.service.accounts('a','x');
  assert.equal(list.find(a=>a.id===source.id).walletBalanceCents,7000);
  assert.equal(list.find(a=>a.id===destination.id).walletBalanceCents,2000);
  assert.equal((await x.service.walletMovements('a','x',destination.id)).length,2);
  assert.equal(await x.service.walletMovements('b','y',destination.id).then(()=>200,e=>e.status),404);
  const movements=await x.service.walletMovements('a','x',source.id);
  assert.equal(movements.length,2);
  await assert.rejects(x.db.prepare('UPDATE finance_wallet_movements SET amount_cents=1 WHERE id=?').bind(movements[0].id).run());
  await assert.rejects(x.db.prepare('DELETE FROM finance_wallet_movements WHERE id=?').bind(movements[0].id).run());
  assert.equal((await x.service.dre('a','x',{from:'2026-10-01',to:'2026-10-31',basis:'accrual'})).resultCents,0,
    'Operational wallet movements never create duplicate accounting income or expense.');
 }finally{x.close();}
});

test('P0 finance searches: canonical category, center, bank match, maturity, status and pagination',async()=>{
 const x=await setup();try{
  const group=await x.service.createGroup('a','x',{name:'Operação',nature:'EXPENSE'});
  const category=await x.service.createCategory('a','x',{name:'Aluguel comercial',kind:'EXPENSE',dreGroupId:group.id});
  const center=await x.service.createCostCenter('a','x',{name:'Matriz'});
  const bank=await x.service.createAccount('a','x','u',{name:'Conta conciliada',walletKind:'BANK'});
  const save=async(id,value,due,kind='PAYABLE')=>x.db.prepare(
   'INSERT INTO finance_entries(id,tenant_id,branch_id,kind,description,amount_cents,due_date,competence_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).bind(id,'a','x',kind,id,value,due,due,'u',now).run();
  await save('rec-early',8000,'2026-10-01');await save('rec-later',3000,'2026-10-30');
  await save('income',1000,'2026-10-17','RECEIVABLE');
  await x.service.classify('a','x','rec-early',{categoryId:category.id,costCenterId:center.id});
  await x.service.importStatement('a','x','u',{accountId:bank.id,transactions:[
   {date:'2026-10-17',amountCents:-2000,description:'Aluguel parcial',fitId:'finance-p0-a'}]});
  const tx=(await x.service.transactions('a','x'))[0];
  await x.service.match('a','x','u',{transactionId:tx.id,entryId:'rec-early'});
  const filters={categoryId:category.id,costCenterId:center.id,groupId:group.id,
   accountId:bank.id,from:'2026-10-01',to:'2026-10-18'};
  const result=await x.service.entriesSearch('a','x',filters);
  assert.equal(result.total,1);assert.equal(result.items[0].id,'rec-early');
  assert.equal(result.items[0].status,'PARTIAL');assert.equal(result.items[0].openCents,6000);
  assert.equal((await x.service.entriesSearch('a','x',{status:'OVERDUE',asOf:'2026-10-17'})).total,1);
  assert.equal((await x.service.entriesSearch('a','x',{kind:'PAYABLE',limit:1,offset:1})).items.length,1);
  assert.equal((await x.service.entriesSearch('b','y')).total,0);
  assert.equal(await x.service.entriesSearch('b','y',{categoryId:category.id}).then(()=>200,e=>e.status),404);
  assert.equal(await x.service.entriesSearch('a','x',{from:'2026-10-20',to:'2026-10-19'}).then(()=>200,e=>e.status),400);
 }finally{x.close();}
});

test('P0 maturity dashboard totals include all 320 entries while response bounds details to 300',async()=>{
 const x=await setup();try{
  const insert=x.db.prepare(`INSERT INTO finance_entries
   (id,tenant_id,branch_id,kind,description,amount_cents,due_date,competence_date,created_by,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?)`);
  for(let i=0;i<320;i++)await insert.bind('due-bulk-'+i,'a','x','PAYABLE','Despesa '+i,100,
   '2026-10-10','2026-10-10','u',now).run();
  const due=await x.service.dueOverview('a','x',{asOf:'2026-10-17',horizonDays:30});
  assert.equal(due.totals.overdueCount,320);
  assert.equal(due.totals.overdueCents,32000);
  assert.equal(due.items.length,300);
  assert.equal(due.truncated,true);
  const outsider=await x.service.dueOverview('b','y',{asOf:'2026-10-17',horizonDays:30});
  assert.equal(outsider.totals.overdueCount,0);
  assert.equal(outsider.totals.overdueCents,0);
 }finally{x.close();}
});
