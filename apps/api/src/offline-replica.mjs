// Node-only Cloudflare -> SQLite baseline replicator.
// No bidirectional sales synchronization exists; local business writes MUST stay blocked.
// Parent entities precede branch-scoped operational records.
const EXTRA=['customers','cash_sessions','sales','sale_items','sale_payments',
 'cash_movements','restaurant_tables','restaurant_table_sessions','restaurant_orders',
 'restaurant_order_items','restaurant_kitchen_tickets','restaurant_service_requests',
 'restaurant_sale_links','r4_item_transfers','r4_split_plans','cash_adjustments','customer_credit_receipts',
 'r4_table_prepayments','r4_table_prepayment_refunds',
 'sale_returns','sale_return_items','sale_refund_movements'];
const ORDER=['tenants','branches','users','tenant_memberships','saas_mfa_totp',
 'product_categories','products','stock_positions',...EXTRA];
// Only mutable projections may be pruned. Historical, financial and
// append-only records are never removed merely to match a cloud row count.
const SAFE_DELETION_TABLES=new Set([
 'product_categories','products','customers','stock_positions','restaurant_tables'
]);
function verify(snapshot,scope){
 if(snapshot?.version!==1||snapshot.baselineOnly!==true||!snapshot.tables||
    snapshot.scope?.tenantId!==scope.tenantId||snapshot.scope?.branchId!==scope.branchId||
    snapshot.scope?.gatewayId!==scope.gatewayId)throw Error('Snapshot fora do escopo autorizado.');
 const tables=snapshot.tables;
 const changed=snapshot.changedTables;
 if(changed!==undefined&&(!Array.isArray(changed)||changed.some(name=>!ORDER.includes(name))))
  throw Error('Lista de tabelas alteradas inválida.');
 if(changed!==undefined&&['tenants','branches','users','tenant_memberships','saas_mfa_totp'].some(t=>!changed.includes(t)))
  throw Error('Identidade não está completa na sincronização incremental.');

 if(!tables.saas_mfa_totp)tables.saas_mfa_totp=[]; // pre-MFA v1 snapshots had no enrolled factors
 for(const table of EXTRA)if(!tables[table])tables[table]=[]; // pre-extension baseline
 if(snapshot.authority&&(!['CLOUD','LOCAL','RECONCILING'].includes(snapshot.authority.mode)||
   !Number.isSafeInteger(snapshot.authority.epoch)||snapshot.authority.epoch<0))throw Error('Autoridade offline inválida.');
 // v1 is a single bounded JSON snapshot; v2 uses authenticated, checksum-
 // verified pages and permits large sets without silently dropping records.
 const maxRows=snapshot.changedTables?100000:2500;
 for(const key of ORDER)if(!Array.isArray(tables[key])||tables[key].length>maxRows)
   throw Error('Snapshot incompleto ou muito grande: '+key);
 if(tables.tenants.length!==1||tables.tenants[0].id!==scope.tenantId)throw Error('Empresa inválida.');
 if(tables.branches.length!==1||tables.branches[0].id!==scope.branchId||
    tables.branches[0].tenant_id!==scope.tenantId)throw Error('Filial inválida.');
 const users=new Set(tables.users.map(x=>x.id));
 for(const row of tables.tenant_memberships)
  if(row.tenant_id!==scope.tenantId||!users.has(row.user_id))throw Error('Vínculo fora da empresa.');
 for(const row of tables.product_categories)if(row.tenant_id!==scope.tenantId)throw Error('Categoria fora da empresa.');
 for(const row of tables.products)if(row.tenant_id!==scope.tenantId)throw Error('Produto fora da empresa.');
 for(const row of tables.stock_positions)
  if(row.tenant_id!==scope.tenantId||row.branch_id!==scope.branchId)throw Error('Estoque fora da filial.');
 for(const table of EXTRA)for(const row of tables[table]){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.tenant_id!==scope.tenantId)
   throw Error('Registro da réplica fora da empresa: '+table);
  if(table!=='customers'&&row.branch_id!==scope.branchId)
   throw Error('Registro da réplica fora da filial: '+table);
 }
 return tables;
}
export async function applyOfflineBaseline(db,snapshot,scope){
 const tables=verify(snapshot,scope);
 const existing=(await db.prepare('SELECT id FROM tenants LIMIT 2').bind().all()).results;
 const state=await db.prepare('SELECT tenant_id AS tenantId,branch_id AS branchId,gateway_id AS gatewayId FROM offline_replica_state LIMIT 2').bind().all();
 if(existing.length&&(!state.results.length||state.results.length!==1||
    state.results[0].tenantId!==scope.tenantId||state.results[0].branchId!==scope.branchId||
    state.results[0].gatewayId!==scope.gatewayId))
   throw Error('Banco já provisionado: nunca sobrescrever uma loja local. Use um SQLite vazio e separado.');
 // A database from another shop was rejected above using the gateway-bound
 // offline_replica_state. Authorized, reconciled local sales MUST be allowed to
 // remain: an unconditional sales.count guard would break the second pull.

 const outstanding=(await db.prepare("SELECT COUNT(*) AS n FROM offline_outbox WHERE status IN('PENDING','CONFLICT')").bind().first()).n;
 db.exec('BEGIN IMMEDIATE');
 try{
  // Removed/cloud-revoked members cannot retain previously copied permission.
  await db.prepare('UPDATE tenant_memberships SET active=0 WHERE tenant_id=?').bind(scope.tenantId).run();
  await db.prepare('UPDATE users SET active=0 WHERE id IN(SELECT user_id FROM tenant_memberships WHERE tenant_id=?)').bind(scope.tenantId).run();
  const finalSessionStatus=[];
  const finalSaleStatus=[];
  const finalCashStatus=[];
  for(const table of ORDER){
   if(snapshot.changedTables&&!snapshot.changedTables.includes(table))continue;
   // WAN may return while waiter/cash writes are still queued. Never import a
   // cloud business projection over those newer local changes before every
   // event has a durable D1 ACK. Users and product catalog can still refresh.
   if(outstanding>0&&table!=='customers'&&EXTRA.includes(table))continue;
   if(table==='stock_positions'&&outstanding>0)continue;
   const columns=(await db.prepare('PRAGMA table_info('+table+')').bind().all()).results.map(x=>x.name);
   if(!columns.length)throw Error('Tabela inexistente: '+table);
   const allowed=new Set(columns);
   if(table==='saas_mfa_totp'){
    const allowedUsers=new Set(tables.users.map(u=>u.id));
    for(const record of tables[table])if(!allowedUsers.has(record.user_id)||
      typeof record.cipher!=='string'||typeof record.iv!=='string'||!record.enrolled_at)
      throw Error('Fator MFA fora do escopo ou inválido.');
    if(tables[table].length){
      await db.prepare('DELETE FROM saas_mfa_totp WHERE user_id IN (SELECT user_id FROM tenant_memberships WHERE tenant_id=?) AND enrolled_at IS NOT NULL AND user_id NOT IN ('+
        tables[table].map(()=>'?').join(',')+')')
        .bind(scope.tenantId,...tables[table].map(u=>u.user_id)).run();
    }else{
      await db.prepare('DELETE FROM saas_mfa_totp WHERE enrolled_at IS NOT NULL AND user_id IN (SELECT user_id FROM tenant_memberships WHERE tenant_id=?)')
        .bind(scope.tenantId).run();
    }
   }
   for(const original of tables[table]){
    if(!original||Array.isArray(original)||typeof original!=='object')throw Error('Linha inválida.');
    let record=original;
    // The canonical trigger prohibits inserting orders in closed sessions.
    // Import a session as OPEN transiently within this one DB transaction and
    // restore final state only after all of its dependent orders are present.
    if(table==='restaurant_table_sessions'&&original.status!=='OPEN'){
      finalSessionStatus.push({id:original.id,status:original.status,closedAt:original.closed_at});
      record={...original,status:'OPEN',closed_at:null};
    }
    if(table==='cash_sessions'&&original.status==='CLOSED'){
      const oldDrawer=await db.prepare('SELECT status FROM cash_sessions WHERE tenant_id=? AND branch_id=? AND id=?')
       .bind(scope.tenantId,scope.branchId,original.id).first();
      if(oldDrawer?.status==='CLOSED')continue; // Never update closed immutable ledger projections.
      finalCashStatus.push({
        id:original.id,closedAt:original.closed_at,closedBy:original.closed_by_user_id,
        counted:original.counted_cash_cents,expected:original.expected_cash_cents,
        divergence:original.divergence_cents
      });
      record={...original,status:'OPEN',closed_at:null,closed_by_user_id:null,
        counted_cash_cents:null,expected_cash_cents:null,divergence_cents:null};
    }
    if(table==='sales'){
      const existingSale=await db.prepare('SELECT status FROM sales WHERE tenant_id=? AND branch_id=? AND id=?')
        .bind(scope.tenantId,scope.branchId,original.id).first();
      if(['COMPLETED','CANCELLED'].includes(existingSale?.status)){
        if(original.status!==existingSale.status)throw Error('Snapshot tenta reabrir venda finalizada.');
        continue; // Canonical closed sales cannot be updated, including no-op UPDATE.
      }
      if(original.status!=='OPEN'){
        finalSaleStatus.push({id:original.id,status:original.status,completedAt:original.completed_at});
        record={...original,status:'OPEN',completed_at:null};
      }
    }
    // An immutable ledger row can already be installed by a previous pull.
    // Avoid issuing INSERT (even ON CONFLICT DO NOTHING), because database
    // BEFORE INSERT triggers run before SQLite resolves uniqueness conflicts.
    if(['sale_items','sale_payments','cash_movements','restaurant_order_items',
      'restaurant_sale_links','r4_item_transfers','cash_adjustments','customer_credit_receipts',
      'r4_table_prepayments','r4_table_prepayment_refunds','sale_returns',
      'sale_return_items','sale_refund_movements'].includes(table)){
      const current=await db.prepare('SELECT id FROM '+table+' WHERE id=? AND tenant_id=? AND branch_id=?')
        .bind(record.id,scope.tenantId,scope.branchId).first();
      if(current)continue;
    }
    const names=Object.keys(record);
    if(!names.length||names.some(name=>!allowed.has(name)))throw Error('Schema incompatível em '+table);
    const placeholders=names.map(()=>'?').join(',');
    const appendOnly=['sale_items','sale_payments','cash_movements',
      'restaurant_order_items','restaurant_sale_links','r4_item_transfers','cash_adjustments',
      'customer_credit_receipts','r4_table_prepayments','r4_table_prepayment_refunds',
      'sale_returns','sale_return_items','sale_refund_movements'].includes(table);
    const sql='INSERT INTO '+table+'('+names.join(',')+') VALUES('+placeholders+') '+
      (appendOnly?'ON CONFLICT DO NOTHING':'ON CONFLICT DO UPDATE SET '+
      names.filter(k=>!['id','tenant_id','branch_id','user_id','product_id'].includes(k)).map(k=>
        k==='last_counter'&&table==='saas_mfa_totp'?'last_counter=MAX(saas_mfa_totp.last_counter,excluded.last_counter)':k+'=excluded.'+k
      ).join(','));
    // A primary-key-only record needs DO NOTHING; all supported rows have mutable columns.
    await db.prepare(sql).bind(...names.map(n=>record[n]===undefined?null:record[n])).run();
   }
  }
  for(const update of finalSaleStatus){
    await db.prepare('UPDATE sales SET status=?,completed_at=? WHERE tenant_id=? AND branch_id=? AND id=?')
      .bind(update.status,update.completedAt,scope.tenantId,scope.branchId,update.id).run();
  }
  for(const update of finalCashStatus){
    await db.prepare('UPDATE cash_sessions SET status=?,closed_at=?,closed_by_user_id=?,expected_cash_cents=?,counted_cash_cents=?,divergence_cents=? WHERE tenant_id=? AND branch_id=? AND id=?')
      .bind('CLOSED',update.closedAt,update.closedBy,update.expected,update.counted,update.divergence,scope.tenantId,scope.branchId,update.id).run();
  }
  for(const update of finalSessionStatus){
    await db.prepare('UPDATE restaurant_table_sessions SET status=?,closed_at=? WHERE tenant_id=? AND branch_id=? AND id=?')
      .bind(update.status,update.closedAt,scope.tenantId,scope.branchId,update.id).run();
  }
  if(snapshot.authority){
   const previous=await db.prepare('SELECT mode,epoch,gateway_id AS gatewayId FROM offline_local_authority WHERE tenant_id=? AND branch_id=?')
    .bind(scope.tenantId,scope.branchId).first();
   if(previous&&previous.gatewayId!==scope.gatewayId)
    throw Error('O PC local não corresponde mais ao gateway autorizado.');
   if(previous&&previous.epoch!==snapshot.authority.epoch&&outstanding>0)
    throw Error('Fila local pendente: não mude geração da autoridade sem conciliação.');
   // The 15-second cloud pull and the manual handoff can run concurrently.
   // Never turn RECONCILING back into LOCAL from a stale cloud snapshot.
   const mode=previous?.mode==='RECONCILING'&&snapshot.authority.mode==='LOCAL'
     ?'RECONCILING':snapshot.authority.mode;
   await db.prepare('INSERT INTO offline_local_authority(tenant_id,branch_id,gateway_id,epoch,mode,refreshed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET epoch=excluded.epoch,mode=excluded.mode,refreshed_at=excluded.refreshed_at')
    .bind(scope.tenantId,scope.branchId,scope.gatewayId,snapshot.authority.epoch,mode,Date.now()).run();
  }
  // v2 transports a complete, revision-stable dataset per changed table.
  // Reconcile cloud-side deletions only for mutable projections, inside the
  // same SQLite transaction as inserts/updates and version stamping.
  // Delete children before parents (stock -> products -> categories).
  // Never discard rows while local mutations may still be awaiting D1 ACK.
  for(const table of [...ORDER].reverse()){
    if(!SAFE_DELETION_TABLES.has(table)||!Object.hasOwn(snapshot.datasetVersions||{},table)||
       outstanding>0)continue;
    // stock_positions has composite scope+product_id, not an id column.
    const keyColumn=table==='stock_positions'?'product_id':'id';
    const authoritativeIds=new Set(tables[table].map(row=>row[keyColumn]));
    if(authoritativeIds.size!==tables[table].length||authoritativeIds.has(undefined))
      throw Error('Dataset duplicado ou sem chave: '+table);
    const tenantOnly=['product_categories','products','customers'].includes(table);
    const predicate='tenant_id=?'+(tenantOnly?'':' AND branch_id=?');
    const scopeParams=tenantOnly?[scope.tenantId]:[scope.tenantId,scope.branchId];
    const localIds=(await db.prepare('SELECT '+keyColumn+' AS local_key FROM '+table+' WHERE '+predicate)
      .bind(...scopeParams).all()).results;
    for(const row of localIds){
      if(authoritativeIds.has(row.local_key))continue;
      // RESTRICT foreign keys and canonical guards remain active. Any
      // referenced row or unexpected trigger causes full rollback.
      await db.prepare('DELETE FROM '+table+' WHERE '+predicate+' AND '+keyColumn+'=?')
        .bind(...scopeParams,row.local_key).run();
    }
  }
  const damaged=(await db.prepare('PRAGMA foreign_key_check').bind().all()).results;
  if(damaged.length)throw Error('Snapshot falhou na integridade referencial.');
  // v2 transports only changed full datasets. An absent remote row may
  // represent a real delete; never mark that table synced while silently
  // retaining an orphan (particularly stock, sale or permission data).
  for(const [table,meta] of Object.entries(snapshot.datasetVersions||{})){
   if(outstanding>0&&(EXTRA.includes(table)||table==='stock_positions'))continue;
   const tenantOnly=['product_categories','products','customers'].includes(table);
   const result=await db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE tenant_id=?'+
     (tenantOnly?'':' AND branch_id=?')).bind(...(tenantOnly?[scope.tenantId]:[scope.tenantId,scope.branchId])).first();
   if(Number(result.n)!==meta.count)
    throw Error('Exclusão ou divergência detectada em '+table+': revisão requer reconciliação segura, não sobrescrita.');
  }
  if(snapshot.datasetVersions){
   for(const [table,meta] of Object.entries(snapshot.datasetVersions)){
    if(!ORDER.includes(table)||!Number.isSafeInteger(meta.revision)||meta.revision<0||
      !Number.isSafeInteger(meta.count)||meta.count<0)throw Error('Versão de dataset inválida.');
    if(outstanding>0&&EXTRA.includes(table))continue;
    if(outstanding>0&&table==='stock_positions')continue;
    await db.prepare('INSERT INTO offline_downloaded_versions(tenant_id,branch_id,table_name,cloud_revision,row_count,last_success_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET cloud_revision=excluded.cloud_revision,row_count=excluded.row_count,last_success_at=excluded.last_success_at')
     .bind(scope.tenantId,scope.branchId,table,meta.revision,meta.count,Date.now()).run();
    await db.prepare('DELETE FROM offline_download_pages WHERE tenant_id=? AND branch_id=? AND table_name=?')
     .bind(scope.tenantId,scope.branchId,table).run();
   }
  }
  const stamp=new Date().toISOString();
  await db.prepare('INSERT INTO offline_replica_state(tenant_id,branch_id,gateway_id,last_pull_at,state) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET last_pull_at=excluded.last_pull_at,state=excluded.state')
   .bind(scope.tenantId,scope.branchId,scope.gatewayId,stamp,'BASELINE_ONLY').run();
  db.exec('COMMIT');
  return {tenantId:scope.tenantId,branchId:scope.branchId,lastPullAt:stamp,state:'BASELINE_ONLY',
    imported:Object.fromEntries(ORDER.map(table=>[table,tables[table].length]))};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export async function pullOfflineBaseline(db,env,{fetcher=fetch}={}){
 const {OFFLINE_CLOUD_ORIGIN:cloud,OFFLINE_TENANT_ID:tenantId,OFFLINE_BRANCH_ID:branchId,
  OFFLINE_GATEWAY_ID:gatewayId,OFFLINE_GATEWAY_TOKEN:token}=env;
 const origin=new URL(cloud);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)
  throw Error('Cloudflare requer origem HTTPS exata.');
 if(!/^[a-f0-9]{64}$/.test(token||''))throw Error('Token do servidor offline inválido.');
 const scope={tenantId,branchId,gatewayId};
 const signal=AbortSignal.timeout(12000);
 const res=await fetcher(origin.origin+'/api/v1/offline/gateway/snapshot',{
  headers:{authorization:'Bearer '+token,'x-pdv-offline-gateway-id':gatewayId,accept:'application/json'},
  signal,redirect:'error',cache:'no-store'});
 if(!res.ok)throw Object.assign(Error('Cloudflare recusou atualização da cópia ('+res.status+').'),{status:res.status});
 const size=Number(res.headers.get('content-length')||0);
 if(size>4*1024*1024)throw Error('Snapshot excede limite seguro.');
 const raw=await res.text();
 if(raw.length>4*1024*1024)throw Error('Snapshot excede limite seguro.');
 return applyOfflineBaseline(db,JSON.parse(raw),scope);
}
