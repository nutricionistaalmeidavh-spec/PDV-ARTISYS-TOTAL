// D1 extension of the sole canonical commerce finance/sales ledger, never a second balance.
const fail=(status,message)=>Object.assign(new Error(message),{status});
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const str=(v,max=180)=>typeof v==='string'?v.trim().slice(0,max):'';
const validMoney=n=>Number.isSafeInteger(n)&&n>0&&n<=1e9;
const date=s=>{
 if(typeof s!=='string'||!/^20\d\d-\d\d-\d\d$/.test(s)||Number.isNaN(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw fail(400,'Data inválida (AAAA-MM-DD).');
 return s;
};
const dateObj=s=>new Date(date(s)+'T00:00:00Z');
const iso=d=>d.toISOString().slice(0,10);
const clamp=(y,m,d)=>iso(new Date(Date.UTC(y,m,Math.min(d,new Date(Date.UTC(y,m+1,0)).getUTCDate()))));
export function nextRecurrenceDate(current,frequency,day,month){
 const d=dateObj(current);
 if(frequency==='DAILY'){d.setUTCDate(d.getUTCDate()+1);return iso(d);}
 if(frequency==='WEEKLY'){d.setUTCDate(d.getUTCDate()+7);return iso(d);}
 if(frequency==='MONTHLY')return clamp(d.getUTCFullYear(),d.getUTCMonth()+1,day);
 if(frequency==='YEARLY')return clamp(d.getUTCFullYear()+1,month-1,day);
 throw fail(400,'Periodicidade inválida.');
}
async function hash(s){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
const period=({from,to,basis='accrual'}={})=>{
 date(from);date(to);
 if(from>to||dateObj(to)-dateObj(from)>366*864e5||!['cash','accrual'].includes(basis))throw fail(400,'Período ou base inválida.');
 return {from,to,basis};
};
export function createAdvancedFinanceService(db,{now:clock=now}={}){
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const one=(sql,...args)=>q(sql,...args).first();
 const many=async(sql,...args)=>(await q(sql,...args).all()).results;
 const run=(sql,...args)=>q(sql,...args).run();
 const branch=async(t,b)=>{
  if(!await one('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1',t,b))throw fail(404,'Filial não encontrada.');
 };
 const row=async(table,t,b,key)=>{
  const x=await one('SELECT * FROM '+table+' WHERE id=? AND tenant_id=? AND branch_id=?',key,t,b);
  if(!x)throw fail(404,'Registro não encontrado nesta filial.');return x;
 };
 const tx=(t,b,key)=>row('finance_bank_transactions',t,b,key);
 const reconcile=(t,b,key)=>one('SELECT * FROM finance_bank_reconciliations WHERE tenant_id=? AND branch_id=? AND transaction_id=?',t,b,key);
 const stamp=()=>clock();
 return {
  async accounts(t,b){await branch(t,b);return many('SELECT id,name,bank_code AS bankCode,active FROM finance_bank_accounts WHERE tenant_id=? AND branch_id=? ORDER BY name',t,b);},
  async createAccount(t,b,user,body){
   await branch(t,b);const name=str(body?.name,100),bankCode=str(body?.bankCode,20);
   if(name.length<2)throw fail(400,'Nome da conta bancária inválido.');
   const result={id:id(),name,bankCode,active:true};
   await run('INSERT INTO finance_bank_accounts(id,tenant_id,branch_id,name,bank_code,created_by,created_at) VALUES(?,?,?,?,?,?,?)',result.id,t,b,name,bankCode,user,stamp());
   return result;
  },
  async batches(t,b){return many('SELECT id,account_id AS accountId,source_name AS sourceName,imported_at AS importedAt FROM finance_statement_batches WHERE tenant_id=? AND branch_id=? ORDER BY imported_at DESC LIMIT 100',t,b);},
  async importStatement(t,b,user,body){
   const account=await row('finance_bank_accounts',t,b,body?.accountId);
   if(!account.active)throw fail(409,'Conta desativada.');
   if(!Array.isArray(body?.transactions)||body.transactions.length<1||body.transactions.length>500)throw fail(400,'Importe entre 1 e 500 movimentações.');
   const seen=new Map(),normalized=[];
   for(const raw of body.transactions){
    const day=date(raw?.date),amount=raw?.amountCents,description=str(raw?.description),fitId=str(raw?.fitId,128);
    if(!Number.isSafeInteger(amount)||!amount||Math.abs(amount)>1e9||!description)throw fail(400,'Movimentação inválida.');
    const base=fitId?'FIT:'+fitId:'ROW:'+day+'|'+amount+'|'+description.toLowerCase();
    const ordinal=fitId?0:(seen.set(base,(seen.get(base)||0)+1),seen.get(base));
    normalized.push({day,amount,description,fitId,key:await hash(base+'|'+ordinal)});
   }
   const contentHash=await hash(normalized.map(x=>x.key).sort().join('|'));
   const existing=await one('SELECT id FROM finance_statement_batches WHERE tenant_id=? AND branch_id=? AND account_id=? AND content_hash=?',t,b,account.id,contentHash);
   if(existing)return {batchId:existing.id,imported:0,duplicates:normalized.length};
   const batchId=id(),ts=stamp();
   const inserts=[q('INSERT INTO finance_statement_batches(id,tenant_id,branch_id,account_id,source_name,content_hash,imported_at,imported_by) VALUES(?,?,?,?,?,?,?,?)',batchId,t,b,account.id,str(body.sourceName,120)||'Extrato',contentHash,ts,user)];
   for(const x of normalized)inserts.push(q('INSERT OR IGNORE INTO finance_bank_transactions(id,tenant_id,branch_id,account_id,batch_id,transaction_key,tx_date,amount_cents,description,fit_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id(),t,b,account.id,batchId,x.key,x.day,x.amount,x.description,x.fitId,ts));
   try{await db.batch(inserts);}catch(error){
    const winner=await one('SELECT id FROM finance_statement_batches WHERE tenant_id=? AND branch_id=? AND account_id=? AND content_hash=?',t,b,account.id,contentHash);
    if(winner)return {batchId:winner.id,imported:0,duplicates:normalized.length};
    throw error;
   }
   const saved=await one('SELECT COUNT(*) AS n FROM finance_bank_transactions WHERE batch_id=?',batchId);
   return {batchId,imported:saved.n,duplicates:normalized.length-saved.n};
  },
  async transactions(t,b,{accountId='',status=''}={}){
   await branch(t,b);
   if(status&&!['UNMATCHED','MATCH','IGNORE','TRANSFER'].includes(status))throw fail(400,'Status inválido.');
   return many('SELECT x.id,x.account_id AS accountId,x.tx_date AS date,x.amount_cents AS amountCents,x.description,x.fit_id AS fitId,r.decision,r.entry_id AS entryId,r.settlement_id AS settlementId '+
    'FROM finance_bank_transactions x LEFT JOIN finance_bank_reconciliations r ON r.tenant_id=x.tenant_id AND r.branch_id=x.branch_id AND r.transaction_id=x.id '+
    "WHERE x.tenant_id=? AND x.branch_id=? AND (?='' OR x.account_id=?) AND (?='' OR (?='UNMATCHED' AND r.id IS NULL) OR r.decision=?) ORDER BY x.tx_date,x.id LIMIT 500",
    t,b,accountId,accountId,status,status,status);
  },
  async suggestions(t,b,transactionId){
   const x=await tx(t,b,transactionId);if(await reconcile(t,b,x.id))return [];
   return many('SELECT e.id,e.description,e.kind,e.amount_cents AS amountCents,e.due_date AS dueDate,e.amount_cents-COALESCE(SUM(s.amount_cents-COALESCE(r.amount_cents,0)),0) AS openCents '+
    'FROM finance_entries e LEFT JOIN finance_settlements s ON s.entry_id=e.id LEFT JOIN finance_settlement_reversals r ON r.settlement_id=s.id '+
    'WHERE e.tenant_id=? AND e.branch_id=? AND e.cancelled_at IS NULL AND e.kind=? GROUP BY e.id '+
    'HAVING openCents>=? ORDER BY CASE WHEN openCents=? THEN 0 ELSE 1 END,ABS(julianday(e.due_date)-julianday(?)),e.id LIMIT 20',
    t,b,x.amount_cents<0?'PAYABLE':'RECEIVABLE',Math.abs(x.amount_cents),Math.abs(x.amount_cents),x.tx_date);
  },
  async match(t,b,user,{transactionId,entryId}){
   const x=await tx(t,b,transactionId),prior=await reconcile(t,b,x.id);
   if(prior){
    if(prior.decision==='MATCH'&&prior.entry_id===entryId)return {id:prior.id,decision:'MATCH',entryId,settlementId:prior.settlement_id};
    throw fail(409,'Movimentação já tratada.');
   }
   const e=await row('finance_entries',t,b,entryId);
   if(e.cancelled_at||(x.amount_cents<0)!==(e.kind==='PAYABLE'))throw fail(409,'Conta cancelada ou natureza incompatível.');
   const settled=await one('SELECT COALESCE(SUM(s.amount_cents-COALESCE(r.amount_cents,0)),0) AS total FROM finance_settlements s LEFT JOIN finance_settlement_reversals r ON r.settlement_id=s.id WHERE s.tenant_id=? AND s.branch_id=? AND s.entry_id=?',t,b,e.id);
   const amt=Math.abs(x.amount_cents);
   if(amt>e.amount_cents-settled.total)throw fail(409,'Conciliação excederia o saldo da conta.');
   const reconId=id(),settlementId=id();
   try{await db.batch([
    q('INSERT INTO finance_settlements(id,tenant_id,branch_id,entry_id,amount_cents,method,occurred_at,operator_id,mutation_id) VALUES(?,?,?,?,?,?,?,?,?)',settlementId,t,b,e.id,amt,'BANK_TRANSFER',x.tx_date+'T12:00:00.000Z',user,'bank-'+x.id),
    q('INSERT INTO finance_bank_reconciliations(id,tenant_id,branch_id,transaction_id,decision,entry_id,settlement_id,operator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',reconId,t,b,x.id,'MATCH',e.id,settlementId,user,stamp())
   ]);}catch{throw fail(409,'Conciliação concorrente ou conta alterada. Atualize os dados.');}
   return {id:reconId,decision:'MATCH',entryId:e.id,settlementId};
  },
  async linkSettlement(t,b,user,{transactionId,settlementId}){
   const x=await tx(t,b,transactionId);
   if(await reconcile(t,b,x.id))throw fail(409,'Movimentação já conciliada.');
   const s=await one('SELECT s.*,e.kind FROM finance_settlements s JOIN finance_entries e ON e.tenant_id=s.tenant_id AND e.branch_id=s.branch_id AND e.id=s.entry_id LEFT JOIN finance_settlement_reversals r ON r.settlement_id=s.id WHERE s.id=? AND s.tenant_id=? AND s.branch_id=? AND r.id IS NULL',settlementId,t,b);
   if(!s)throw fail(404,'Pagamento não encontrado.');
   if(s.amount_cents!==Math.abs(x.amount_cents)||(x.amount_cents<0)!==(s.kind==='PAYABLE'))throw fail(409,'Valor ou natureza incompatíveis.');
   const rid=id();
   try{await run('INSERT INTO finance_bank_reconciliations(id,tenant_id,branch_id,transaction_id,decision,entry_id,settlement_id,operator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',rid,t,b,x.id,'MATCH',s.entry_id,s.id,user,stamp());}
   catch{throw fail(409,'Pagamento já conciliado.');}
   return {id:rid,decision:'MATCH',entryId:s.entry_id,settlementId:s.id};
  },
  async ignore(t,b,user,transactionId){
   const x=await tx(t,b,transactionId),existing=await reconcile(t,b,x.id);
   if(existing)return existing;
   const rid=id();
   await run('INSERT INTO finance_bank_reconciliations(id,tenant_id,branch_id,transaction_id,decision,operator_id,created_at) VALUES(?,?,?,?,?,?,?)',rid,t,b,x.id,'IGNORE',user,stamp());
   return {id:rid,decision:'IGNORE'};
  },
  async transferSuggestions(t,b){
   return many('SELECT a.id AS fromTransactionId,c.id AS toTransactionId,a.account_id AS fromAccountId,c.account_id AS toAccountId,-a.amount_cents AS amountCents '+
    'FROM finance_bank_transactions a JOIN finance_bank_transactions c ON a.tenant_id=c.tenant_id AND a.branch_id=c.branch_id AND a.account_id<>c.account_id AND a.amount_cents<0 AND c.amount_cents=-a.amount_cents AND ABS(julianday(a.tx_date)-julianday(c.tx_date))<=3 '+
    'LEFT JOIN finance_bank_reconciliations ra ON ra.transaction_id=a.id AND ra.tenant_id=a.tenant_id AND ra.branch_id=a.branch_id '+
    'LEFT JOIN finance_bank_reconciliations rb ON rb.transaction_id=c.id AND rb.tenant_id=c.tenant_id AND rb.branch_id=c.branch_id '+
    'WHERE a.tenant_id=? AND a.branch_id=? AND ra.id IS NULL AND rb.id IS NULL ORDER BY a.tx_date LIMIT 30',t,b);
  },
  async confirmTransfer(t,b,user,{fromTransactionId,toTransactionId}){
   const a=await tx(t,b,fromTransactionId),c=await tx(t,b,toTransactionId);
   if(a.id===c.id||a.account_id===c.account_id||a.amount_cents>=0||c.amount_cents!==-a.amount_cents||Math.abs(dateObj(a.tx_date)-dateObj(c.tx_date))>3*864e5)throw fail(409,'Par de transferência inválido.');
   if(await reconcile(t,b,a.id)||await reconcile(t,b,c.id))throw fail(409,'Movimentação já conciliada.');
   try{await db.batch([
    q('INSERT INTO finance_bank_reconciliations(id,tenant_id,branch_id,transaction_id,decision,paired_transaction_id,operator_id,created_at) VALUES(?,?,?,?,?,?,?,?)',id(),t,b,a.id,'TRANSFER',c.id,user,stamp()),
    q('INSERT INTO finance_bank_reconciliations(id,tenant_id,branch_id,transaction_id,decision,paired_transaction_id,operator_id,created_at) VALUES(?,?,?,?,?,?,?,?)',id(),t,b,c.id,'TRANSFER',a.id,user,stamp())
   ]);}catch{throw fail(409,'A transferência já foi alterada.');}
   return {confirmed:true};
  },
  async recurrences(t,b){return many('SELECT id,description,kind,amount_cents AS amountCents,frequency,next_due_date AS nextDueDate,end_date AS endDate,status FROM finance_recurrences WHERE tenant_id=? AND branch_id=? ORDER BY next_due_date,id',t,b);},
  async createRecurrence(t,b,user,body){
   await branch(t,b);const name=str(body?.description),kind=body?.kind,frequency=body?.frequency,start=date(body?.startDate);
   if(name.length<2||!['PAYABLE','RECEIVABLE'].includes(kind)||!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(frequency)||!validMoney(body?.amountCents))throw fail(400,'Dados de recorrência inválidos.');
   const end=body.endDate?date(body.endDate):null;
   if(end&&end<start)throw fail(400,'Data final anterior ao início.');
   const d=dateObj(start),rid=id();
   await run('INSERT INTO finance_recurrences(id,tenant_id,branch_id,description,kind,amount_cents,frequency,anchor_day,anchor_month,next_due_date,end_date,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    rid,t,b,name,kind,body.amountCents,frequency,d.getUTCDate(),d.getUTCMonth()+1,start,end,stamp(),user);
   return {id:rid,description:name,kind,amountCents:body.amountCents,frequency,nextDueDate:start,endDate:end,status:'ACTIVE'};
  },
  async setRecurrenceStatus(t,b,key,status){
   const x=await row('finance_recurrences',t,b,key);
   if(!['ACTIVE','PAUSED','CANCELLED'].includes(status)||(x.status==='CANCELLED'&&status!=='CANCELLED'))throw fail(409,'Estado inválido.');
   await run('UPDATE finance_recurrences SET status=? WHERE tenant_id=? AND branch_id=? AND id=?',status,t,b,key);
   return {id:key,status};
  },
  async generate(t,b,user,{asOf}){
   const until=date(asOf);await branch(t,b);
   const rules=await many("SELECT * FROM finance_recurrences WHERE tenant_id=? AND branch_id=? AND status='ACTIVE' AND next_due_date<=? ORDER BY next_due_date LIMIT 100",t,b,until);
   let created=0;
   for(const rule of rules){
    const due=[];let next=rule.next_due_date;
    while(next<=until&&(!rule.end_date||next<=rule.end_date)&&due.length<100){
     due.push(next);next=nextRecurrenceDate(next,rule.frequency,rule.anchor_day,rule.anchor_month);
    }
    if(!due.length)continue;
    const steps=due.map(d=>q('INSERT INTO finance_entries(id,tenant_id,branch_id,kind,description,amount_cents,due_date,competence_date,created_by,created_at,source_recurrence_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      'rec-'+rule.id+'-'+d,t,b,rule.kind,rule.description,rule.amount_cents,d,d,user,stamp(),rule.id));
    steps.push(q("UPDATE finance_recurrences SET next_due_date=? WHERE tenant_id=? AND branch_id=? AND id=? AND status='ACTIVE' AND next_due_date=?",next,t,b,rule.id,rule.next_due_date));
    try{await db.batch(steps);created+=due.length;}catch{throw fail(409,'Geração concorrente detectada. Nenhuma parcela foi duplicada.');}
   }
   return {created,processedRules:rules.length};
  },
  async groups(t,b){return many('SELECT id,name,nature,sort_order AS sortOrder FROM finance_dre_groups WHERE tenant_id=? AND branch_id=? ORDER BY sort_order,name',t,b);},
  async createGroup(t,b,{name,nature,sortOrder=50}){
   await branch(t,b);const label=str(name,100);
   if(label.length<2||!['REVENUE','COST','EXPENSE','OTHER'].includes(nature))throw fail(400,'Grupo DRE inválido.');
   const key=id();
   await run('INSERT INTO finance_dre_groups(id,tenant_id,branch_id,name,nature,sort_order) VALUES(?,?,?,?,?,?)',key,t,b,label,nature,Number.isInteger(sortOrder)?sortOrder:50);
   return {id:key,name:label,nature};
  },
  async categories(t,b){
   await branch(t,b);
   return many('SELECT id,name,kind,dre_group_id AS dreGroupId FROM finance_categories WHERE tenant_id=? AND branch_id=? ORDER BY name',t,b);
  },
  async createCategory(t,b,{name,kind,dreGroupId=null}){
   await branch(t,b);const label=str(name,100);
   if(label.length<2||!['INCOME','EXPENSE','BOTH'].includes(kind))throw fail(400,'Categoria financeira inválida.');
   const group=dreGroupId?await row('finance_dre_groups',t,b,dreGroupId):null;
   if(group&&kind==='INCOME'&&!['REVENUE','OTHER'].includes(group.nature)||group&&kind==='EXPENSE'&&!['COST','EXPENSE','OTHER'].includes(group.nature))
    throw fail(400,'Grupo DRE incompatível com categoria.');
   const key=id();await run('INSERT INTO finance_categories(id,tenant_id,branch_id,name,kind,dre_group_id) VALUES(?,?,?,?,?,?)',
    key,t,b,label,kind,dreGroupId);
   return {id:key,name:label,kind,dreGroupId};
  },
  async costCenters(t,b){return many('SELECT id,name FROM finance_cost_centers WHERE tenant_id=? AND branch_id=? ORDER BY name',t,b);},
  async createCostCenter(t,b,{name}){
   await branch(t,b);const label=str(name,100);if(label.length<2)throw fail(400,'Nome do centro de custo inválido.');
   const key=id();
   await run('INSERT INTO finance_cost_centers(id,tenant_id,branch_id,name) VALUES(?,?,?,?)',key,t,b,label);
   return {id:key,name:label};
  },
  async classify(t,b,entryId,{dreGroupId=null,costCenterId=null,categoryId=null}){
   const e=await row('finance_entries',t,b,entryId);
   const category=categoryId?await row('finance_categories',t,b,categoryId):null;
   if(category&&(e.kind==='PAYABLE'&&category.kind==='INCOME'||e.kind==='RECEIVABLE'&&category.kind==='EXPENSE'))
    throw fail(400,'Categoria incompatível com a conta financeira.');
   const groupId=dreGroupId||category?.dre_group_id||null;
   const group=groupId?await row('finance_dre_groups',t,b,groupId):null;
   if(costCenterId)await row('finance_cost_centers',t,b,costCenterId);
   if(group&&!(e.kind==='PAYABLE'?['COST','EXPENSE','OTHER']:['REVENUE','OTHER']).includes(group.nature))
    throw fail(400,'Natureza do grupo incompatível com a conta.');
   await run('INSERT INTO finance_entry_dimensions(tenant_id,branch_id,entry_id,dre_group_id,cost_center_id,category_id) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,branch_id,entry_id) DO UPDATE SET dre_group_id=excluded.dre_group_id,cost_center_id=excluded.cost_center_id,category_id=excluded.category_id',
    t,b,entryId,groupId,costCenterId,categoryId);
   return {entryId,dreGroupId:groupId,costCenterId,categoryId};
  },
  async cashflow(t,b,{from,to}={}){
   await branch(t,b);period({from,to});
   const settlements=await one("SELECT COALESCE(SUM(CASE WHEN e.kind='RECEIVABLE' THEN s.amount_cents-COALESCE(r.amount_cents,0) ELSE 0 END),0) AS received,COALESCE(SUM(CASE WHEN e.kind='PAYABLE' THEN s.amount_cents-COALESCE(r.amount_cents,0) ELSE 0 END),0) AS paid FROM finance_settlements s LEFT JOIN finance_settlement_reversals r ON r.settlement_id=s.id JOIN finance_entries e ON e.id=s.entry_id AND e.tenant_id=s.tenant_id AND e.branch_id=s.branch_id WHERE e.tenant_id=? AND e.branch_id=? AND substr(s.occurred_at,1,10) BETWEEN ? AND ?",t,b,from,to);
   const sales=await one("SELECT COALESCE(SUM(p.amount_cents-CASE WHEN p.method='CASH' THEN s.change_cents ELSE 0 END),0) AS amount FROM sale_payments p JOIN sales s ON s.id=p.sale_id AND s.tenant_id=p.tenant_id AND s.branch_id=p.branch_id WHERE s.tenant_id=? AND s.branch_id=? AND s.status='COMPLETED' AND substr(p.created_at,1,10) BETWEEN ? AND ?",t,b,from,to);
   const future=await one("SELECT COALESCE(SUM(CASE WHEN e.kind='RECEIVABLE' THEN e.amount_cents-COALESCE(x.paid,0) ELSE 0 END),0) AS incoming,COALESCE(SUM(CASE WHEN e.kind='PAYABLE' THEN e.amount_cents-COALESCE(x.paid,0) ELSE 0 END),0) AS outgoing FROM finance_entries e LEFT JOIN (SELECT f.entry_id,SUM(f.amount_cents-COALESCE(r.amount_cents,0)) AS paid FROM finance_settlements f LEFT JOIN finance_settlement_reversals r ON r.settlement_id=f.id GROUP BY f.entry_id) x ON x.entry_id=e.id WHERE e.tenant_id=? AND e.branch_id=? AND e.cancelled_at IS NULL AND e.due_date BETWEEN ? AND ?",t,b,from,to);
   return {from,to,realizedInflowCents:settlements.received+sales.amount,realizedOutflowCents:settlements.paid,projectedReceivableCents:future.incoming,projectedPayableCents:future.outgoing,projectedClosingDeltaCents:settlements.received+sales.amount-settlements.paid+future.incoming-future.outgoing};
  },
  async dre(t,b,filters){
   await branch(t,b);const {from,to,basis}=period(filters);
   const sales=basis==='accrual'
    ?await one("SELECT COALESCE(SUM(total_cents),0) AS n FROM sales WHERE tenant_id=? AND branch_id=? AND status='COMPLETED' AND substr(completed_at,1,10) BETWEEN ? AND ?",t,b,from,to)
    :await one("SELECT COALESCE(SUM(p.amount_cents-CASE WHEN p.method='CASH' THEN s.change_cents ELSE 0 END),0) AS n FROM sale_payments p JOIN sales s ON s.id=p.sale_id AND s.tenant_id=p.tenant_id AND s.branch_id=p.branch_id WHERE s.tenant_id=? AND s.branch_id=? AND s.status='COMPLETED' AND substr(p.created_at,1,10) BETWEEN ? AND ?",t,b,from,to);
   const col=basis==='cash'?'(f.amount_cents-COALESCE(r.amount_cents,0))':'e.amount_cents';
   const dateCol=basis==='cash'?'substr(f.occurred_at,1,10)':'COALESCE(e.competence_date,e.due_date)';
   const join=basis==='cash'?' JOIN finance_settlements f ON f.entry_id=e.id AND f.tenant_id=e.tenant_id AND f.branch_id=e.branch_id LEFT JOIN finance_settlement_reversals r ON r.settlement_id=f.id ':' ';
   const groups=await many('SELECT COALESCE(g.id,CASE WHEN e.kind=\'RECEIVABLE\' THEN \'other-income\' ELSE \'other-expense\' END) AS id, '+
    'COALESCE(g.name,CASE WHEN e.kind=\'RECEIVABLE\' THEN \'Outras receitas\' ELSE \'Despesas sem classificação\' END) AS name, '+
    'COALESCE(g.nature,CASE WHEN e.kind=\'RECEIVABLE\' THEN \'REVENUE\' ELSE \'EXPENSE\' END) AS nature, '+
    'COALESCE(d.cost_center_id,\'\') AS costCenterId,SUM(CASE WHEN g.nature=\'OTHER\' AND e.kind=\'PAYABLE\' THEN -('+col+') ELSE '+col+' END) AS amountCents FROM finance_entries e '+join+
    'LEFT JOIN finance_entry_dimensions d ON d.tenant_id=e.tenant_id AND d.branch_id=e.branch_id AND d.entry_id=e.id '+
    'LEFT JOIN finance_dre_groups g ON g.tenant_id=e.tenant_id AND g.branch_id=e.branch_id AND g.id=d.dre_group_id '+
    'WHERE e.tenant_id=? AND e.branch_id=? AND e.cancelled_at IS NULL AND '+dateCol+' BETWEEN ? AND ? '+
    'GROUP BY 1,2,3,4 ORDER BY nature,name,costCenterId',t,b,from,to);
   if(sales.n)groups.unshift({id:'pdv-sales',name:'Vendas do PDV',nature:'REVENUE',costCenterId:'',amountCents:sales.n});
   const totals={revenueCents:0,costCents:0,expenseCents:0,otherCents:0};
   for(const x of groups){const k={REVENUE:'revenueCents',COST:'costCents',EXPENSE:'expenseCents',OTHER:'otherCents'}[x.nature];totals[k]+=x.amountCents;}
   const resultCents=totals.revenueCents-totals.costCents-totals.expenseCents+totals.otherCents;
   return {...totals,from,to,basis,groups,resultCents,marginPercent:totals.revenueCents?Math.round(resultCents/totals.revenueCents*1e4)/100:0};
  },
  async dreDetails(t,b,{from,to,basis='accrual',groupId}){
   period({from,to,basis});await branch(t,b);
   if(groupId==='pdv-sales')return many("SELECT id,completed_at AS date,sale_number AS description,total_cents AS amountCents FROM sales WHERE tenant_id=? AND branch_id=? AND status='COMPLETED' AND substr(completed_at,1,10) BETWEEN ? AND ? ORDER BY completed_at DESC LIMIT 200",t,b,from,to);
   const dt=basis==='cash'?'substr(f.occurred_at,1,10)':'COALESCE(e.competence_date,e.due_date)';
   const join=basis==='cash'?' JOIN finance_settlements f ON f.entry_id=e.id AND f.tenant_id=e.tenant_id AND f.branch_id=e.branch_id LEFT JOIN finance_settlement_reversals r ON r.settlement_id=f.id ':' ';
   const amt=basis==='cash'?'(f.amount_cents-COALESCE(r.amount_cents,0))':'e.amount_cents';
   return many('SELECT e.id,e.description,'+dt+' AS date,'+amt+' AS amountCents,e.kind FROM finance_entries e '+join+
    'LEFT JOIN finance_entry_dimensions d ON d.tenant_id=e.tenant_id AND d.branch_id=e.branch_id AND d.entry_id=e.id '+
    'WHERE e.tenant_id=? AND e.branch_id=? AND e.cancelled_at IS NULL AND '+dt+' BETWEEN ? AND ? AND '+
    "(d.dre_group_id=? OR (?='other-income' AND d.dre_group_id IS NULL AND e.kind='RECEIVABLE') OR (?='other-expense' AND d.dre_group_id IS NULL AND e.kind='PAYABLE')) ORDER BY date DESC,e.id LIMIT 200",
    t,b,from,to,groupId,groupId,groupId);
  }
 };
}
