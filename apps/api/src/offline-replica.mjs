// Node-only Cloudflare -> SQLite baseline replicator.
// No bidirectional sales synchronization exists; local business writes MUST stay blocked.
const ORDER=['tenants','branches','users','tenant_memberships','saas_mfa_totp','product_categories','products','stock_positions'];
function verify(snapshot,scope){
 if(snapshot?.version!==1||snapshot.baselineOnly!==true||!snapshot.tables||
    snapshot.scope?.tenantId!==scope.tenantId||snapshot.scope?.branchId!==scope.branchId||
    snapshot.scope?.gatewayId!==scope.gatewayId)throw Error('Snapshot fora do escopo autorizado.');
 const tables=snapshot.tables;
 if(!tables.saas_mfa_totp)tables.saas_mfa_totp=[]; // pre-MFA v1 snapshots had no enrolled factors
 if(snapshot.authority&&(!['CLOUD','LOCAL','RECONCILING'].includes(snapshot.authority.mode)||
   !Number.isSafeInteger(snapshot.authority.epoch)||snapshot.authority.epoch<0))throw Error('Autoridade offline inválida.');
 for(const key of ORDER)if(!Array.isArray(tables[key])||tables[key].length>2500)
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
 const count=await db.prepare('SELECT COUNT(*) AS n FROM sales').bind().first();
 if(count.n>0)throw Error('Vendas locais presentes: reconciliação obrigatória antes de atualizar cópia.');
 const outstanding=(await db.prepare("SELECT COUNT(*) AS n FROM offline_outbox WHERE status IN('PENDING','CONFLICT')").bind().first()).n;
 db.exec('BEGIN IMMEDIATE');
 try{
  // Removed/cloud-revoked members cannot retain previously copied permission.
  await db.prepare('UPDATE tenant_memberships SET active=0 WHERE tenant_id=?').bind(scope.tenantId).run();
  await db.prepare('UPDATE users SET active=0 WHERE id IN(SELECT user_id FROM tenant_memberships WHERE tenant_id=?)').bind(scope.tenantId).run();
  for(const table of ORDER){
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
   for(const record of tables[table]){
    if(!record||Array.isArray(record)||typeof record!=='object')throw Error('Linha inválida.');
    const names=Object.keys(record);
    if(!names.length||names.some(name=>!allowed.has(name)))throw Error('Schema incompatível em '+table);
    const placeholders=names.map(()=>'?').join(',');
    const sql='INSERT INTO '+table+'('+names.join(',')+') VALUES('+placeholders+') ON CONFLICT DO UPDATE SET '+
      names.filter(k=>!['id','tenant_id','branch_id','user_id','product_id'].includes(k)).map(k=>
        k==='last_counter'&&table==='saas_mfa_totp'?'last_counter=MAX(saas_mfa_totp.last_counter,excluded.last_counter)':k+'=excluded.'+k
      ).join(',');
    // A primary-key-only record needs DO NOTHING; all supported rows have mutable columns.
    await db.prepare(sql).bind(...names.map(n=>record[n]===undefined?null:record[n])).run();
   }
  }
  if(snapshot.authority){
   await db.prepare('INSERT INTO offline_local_authority(tenant_id,branch_id,gateway_id,epoch,mode,refreshed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET epoch=excluded.epoch,mode=excluded.mode,refreshed_at=excluded.refreshed_at')
    .bind(scope.tenantId,scope.branchId,scope.gatewayId,snapshot.authority.epoch,snapshot.authority.mode,Date.now()).run();
  }
  const damaged=(await db.prepare('PRAGMA foreign_key_check').bind().all()).results;
  if(damaged.length)throw Error('Snapshot falhou na integridade referencial.');
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
