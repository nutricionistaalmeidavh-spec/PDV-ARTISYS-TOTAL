// Node-only authenticated v2 sync: O(1) revisions, keyset paging,
// persistent page staging, per-page SHA256, optimistic manifest stability,
// atomic SQLite projection and legacy snapshot fallback for older Workers.
import {sha256} from './password.mjs';
import {applyOfflineBaseline,pullOfflineBaseline} from './offline-replica.mjs';
import {DATASETS} from './offline-fast-stream.mjs';
const AUTH=['tenants','branches','users','tenant_memberships','saas_mfa_totp'];
const ID=/^[a-zA-Z0-9-]{1,128}$/;
function checkEnv(env){
 const {OFFLINE_CLOUD_ORIGIN:cloud,OFFLINE_TENANT_ID:tenantId,OFFLINE_BRANCH_ID:branchId,
  OFFLINE_GATEWAY_ID:gatewayId,OFFLINE_GATEWAY_TOKEN:token}=env;
 const url=new URL(cloud);
 if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password||
    ![tenantId,branchId,gatewayId].every(x=>ID.test(x||''))||!/^[a-f0-9]{64}$/.test(token||''))
  throw Error('Parâmetros do gateway offline não autorizados.');
 return {origin:url.origin,tenantId,branchId,gatewayId,token};
}
export async function pullOfflineFast(db,env,{fetcher=fetch,pageSize=75}={}){
 const scope=checkEnv(env);
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw Error('Lote deve ter entre 1 e 100 linhas.');
 const headers={authorization:'Bearer '+scope.token,'x-pdv-offline-gateway-id':scope.gatewayId,accept:'application/json'};
 async function request(url){
  const response=await fetcher(scope.origin+'/api/v1/offline/gateway/'+url,{
   method:'GET',headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(response.status===404&&url==='summary')return null; // rolling deploy compatibility
  if(!response.ok)throw Object.assign(Error('Gateway recusou '+url+' ('+response.status+').'),{status:response.status});
  const text=await response.text();
  if(text.length>1024*1024)throw Error('Página/manifesto excede 1 MB.');
  return JSON.parse(text);
 }
 const first=await request('summary');
 if(!first)return {...await pullOfflineBaseline(db,env,{fetcher}),protocol:1};
 function assertSummary(summary){
  if(summary?.version!==2||summary.scope?.tenantId!==scope.tenantId||
   summary.scope?.branchId!==scope.branchId||summary.scope?.gatewayId!==scope.gatewayId||
   !summary.tables||!['LOCAL','CLOUD','RECONCILING'].includes(summary.authority?.mode)||
   !Number.isSafeInteger(summary.authority?.epoch))throw Error('Sumário de sincronização inválido.');
  for(const table of Object.keys(DATASETS)){
   const m=summary.tables[table];
   if(!Number.isSafeInteger(m?.count)||m.count<0||!Number.isSafeInteger(m?.revision)||m.revision<0)
    throw Error('Versão do sumário inválida: '+table);
  }
 }
 assertSummary(first);
 const identity=await request('identity');
 if(identity?.version!==2||identity.scope?.tenantId!==scope.tenantId||
  identity.scope?.branchId!==scope.branchId||identity.scope?.gatewayId!==scope.gatewayId)
  throw Error('Identidade e autorização fora do escopo.');
 const existing=(await db.prepare('SELECT table_name AS name,cloud_revision AS revision,row_count AS count FROM offline_downloaded_versions WHERE tenant_id=? AND branch_id=?')
  .bind(scope.tenantId,scope.branchId).all()).results;
 const versions=new Map(existing.map(row=>[row.name,row]));
 const pending=(await db.prepare("SELECT COUNT(*) AS n FROM offline_outbox WHERE status IN('PENDING','CONFLICT')").bind().first()).n;
 const changed=[];
 for(const table of Object.keys(DATASETS)){
  const meta=first.tables[table],old=versions.get(table);
  if((!old||old.revision!==meta.revision||old.count!==meta.count)&&
    !(pending>0&&(DATASETS[table]==='branch'||table!=='product_categories'&&table!=='products'&&table!=='customers')))
   changed.push(table);
 }
 const tables={...identity.tables};
 const datasetVersions={};
 let transferredRows=0,resumedPages=0;
 for(const table of changed){
  const target=first.tables[table];
  await db.prepare('DELETE FROM offline_download_pages WHERE tenant_id=? AND branch_id=? AND table_name=? AND cloud_revision<>?')
   .bind(scope.tenantId,scope.branchId,table,target.revision).run();
  const cached=(await db.prepare('SELECT page_start AS start,page_end AS end,payload_json AS payload,checksum FROM offline_download_pages WHERE tenant_id=? AND branch_id=? AND table_name=? AND cloud_revision=? ORDER BY page_start')
   .bind(scope.tenantId,scope.branchId,table,target.revision).all()).results;
  let rows=[],cursor=0;
  for(const page of cached){
   if(page.start!==cursor)break;
   const part=JSON.parse(page.payload);
   if(!Array.isArray(part)||await sha256(JSON.stringify(part))!==page.checksum)break;
   rows.push(...part);cursor=page.end;resumedPages++;
  }
  let limit=pageSize;
  while(rows.length<target.count){
   let page;
   try{page=await request('page?table='+encodeURIComponent(table)+'&after='+cursor+'&limit='+limit);}
   catch(error){
    if(error.status===413&&limit>1){limit=Math.max(1,Math.floor(limit/2));continue;}
    throw error;
   }
   if(page?.version!==2||page.table!==table||page.after!==cursor||
    !Array.isArray(page.rows)||page.rows.length<1||page.rows.length>limit||
    !Number.isSafeInteger(page.next)||page.next<=cursor||page.count!==page.rows.length||
    await sha256(JSON.stringify(page.rows))!==page.checksum)
    throw Error('Página corrompida ou sequência interrompida: '+table);
   const payload=JSON.stringify(page.rows);
   await db.prepare('INSERT INTO offline_download_pages(tenant_id,branch_id,table_name,cloud_revision,page_start,page_end,payload_json,checksum) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,branch_id,table_name,cloud_revision,page_start) DO UPDATE SET page_end=excluded.page_end,payload_json=excluded.payload_json,checksum=excluded.checksum')
    .bind(scope.tenantId,scope.branchId,table,target.revision,cursor,page.next,payload,page.checksum).run();
   rows.push(...page.rows);cursor=page.next;transferredRows+=page.rows.length;
   if(rows.length>target.count)throw Error('Volume excedeu o manifesto: '+table);
  }
  if(rows.length!==target.count)throw Error('Páginas não correspondem ao sumário: '+table);
  if(table==='products')rows.sort((a,b)=>Boolean(a.parent_product_id)-Boolean(b.parent_product_id));
  tables[table]=rows;
  datasetVersions[table]=target;
 }
 const final=await request('summary');
 assertSummary(final);
 if(first.authority.epoch!==final.authority.epoch||first.authority.mode!==final.authority.mode||
  Object.keys(DATASETS).some(table=>first.tables[table].revision!==final.tables[table].revision||
    first.tables[table].count!==final.tables[table].count))
  throw Error('Dados D1 mudaram durante transferência: manter páginas e tentar novamente.');
 // Missing tables are *not* empty datasets; a sparse snapshot means skip them.
 for(const table of Object.keys(DATASETS))if(!tables[table])tables[table]=[];
 const changedTables=[...AUTH,...changed];
 const applied=await applyOfflineBaseline(db,{
  version:1,baselineOnly:true,scope:{tenantId:scope.tenantId,branchId:scope.branchId,gatewayId:scope.gatewayId},
  authority:first.authority,tables,changedTables,datasetVersions},scope);
 return {...applied,protocol:2,changed,transferredRows,resumedPages};
}
