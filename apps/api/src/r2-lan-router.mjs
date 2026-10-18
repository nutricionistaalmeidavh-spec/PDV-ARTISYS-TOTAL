import {zipJsonEntries} from './r2-diagnostics-zip.mjs';
import {sha256,newSessionToken} from './password.mjs';

const KINDS=new Set(['TERMINAL','WAITER','KITCHEN']);
const ADMINS=new Set(['OWNER','ADMINISTRATOR']);
const DEVICE_ROLES={
  TERMINAL:new Set(['OWNER','ADMINISTRATOR','MANAGER','SUPERVISOR','CASHIER','OPERATOR']),
  WAITER:new Set(['OWNER','ADMINISTRATOR','MANAGER','SUPERVISOR','WAITER']),
  KITCHEN:new Set(['OWNER','ADMINISTRATOR','MANAGER','SUPERVISOR','KITCHEN'])
};
export const R2_PILOT_CHECKS=Object.freeze([
  {key:'identify-server',title:'Papel do servidor e endereço HTTPS',category:'deployment'},
  {key:'lan-test',title:'Conexão HTTPS com certificado confiável em duas máquinas',category:'lan'},
  {key:'terminal-register',title:'Pareamento, permissão e revogação de dois terminais',category:'lan'},
  {key:'waiter-kitchen',title:'Dispositivos de salão e cozinha, se utilizados',category:'lan',optional:true},
  {key:'backup-manual',title:'Backup SQLite consistente',category:'recovery'},
  {key:'restore-test',title:'Restauração em banco isolado com serviço de produção parado',category:'recovery'},
  {key:'offline-test',title:'Operação LAN sem acesso à Internet',category:'recovery'},
  {key:'sale-test',title:'Venda e concorrência entre operadores',category:'operations'},
  {key:'cash-close-test',title:'Fechamento de caixa por terminal',category:'operations'},
  {key:'diagnostics',title:'Diagnósticos e logs sem dados sensíveis',category:'support'},
  {key:'printer-test',title:'Impressora testada fisicamente',category:'hardware',optional:true},
  {key:'scale-test',title:'Balança testada fisicamente',category:'hardware',optional:true}
]);

function json(data,status=200){return new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});}
function err(status,message){return json({error:message},status);}
function isAdmin(member){return ADMINS.has(member.profileKey);}
function uuid(){return crypto.randomUUID();}
function mappedDevice(row){
  return {id:row.id,tenantId:row.tenant_id,branchId:row.branch_id,kind:row.kind,
    name:row.name,active:Boolean(row.active),createdAt:row.created_at,
    lastSeenAt:row.last_seen_at,revokedAt:row.revoked_at};
}
async function parse(request){
  if(Number(request.headers.get('content-length')||0)>4096)return null;
  const raw=await request.text();
  if(raw.length>4096)return null;
  try{const value=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}
  catch{return null;}
}
async function audit(db,tenantId,userId,action,type,id,now){
  await db.prepare('INSERT INTO r2_audit(id,tenant_id,actor_id,action,target_type,target_id,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(uuid(),tenantId,userId,action,type,id,now).run();
}
function viewReadiness(rows){
  const known=new Map(rows.map(row=>[row.check_key,row]));
  const checks=R2_PILOT_CHECKS.map(item=>{
    const saved=known.get(item.key);
    return {...item,status:saved?.status||'NOT_STARTED',note:saved?.note||'',
      evidenceRef:saved?.evidence_ref||'',updatedAt:saved?.updated_at||null};
  });
  return {ready:checks.every(item=>item.status==='READY'||item.optional&&item.status==='NOT_APPLICABLE'),
    checks,readyCount:checks.filter(item=>item.status==='READY').length,total:checks.length};
}

export async function r2LanRoute(request,db,session,member,tenantId,path,{now=()=>Date.now()}={}){
  if(!path.startsWith('lan/'))return null;
  const method=request.method,parts=path.split('/'),owner=isAdmin(member);
  const instant=now();
  const userId=session.userId;
  try{
    if(path==='lan/access'&&method==='GET'){
      const url=new URL(request.url);
      if(url.protocol!=='https:')return err(403,'Acesso LAN exige HTTPS.');
      return json({url:url.origin+'/',origin:url.origin,secure:true,
        note:'Utilize a mesma PWA em cada aparelho; o código de pareamento não substitui login.'});
    }
    if(path==='lan/devices'&&method==='GET'){
      if(!owner)return err(403,'Somente o administrador consulta dispositivos.');
      const {results}=await db.prepare('SELECT * FROM r2_devices WHERE tenant_id=? ORDER BY created_at DESC,id DESC')
        .bind(tenantId).all();
      return json({devices:results.map(mappedDevice)});
    }
    if(path==='lan/pairings'&&method==='POST'){
      if(!owner)return err(403,'Somente o administrador abre pareamentos.');
      const body=await parse(request);
      const kind=String(body?.kind||'').toUpperCase();
      const branchId=String(body?.branchId||'');
      if(!KINDS.has(kind)||!branchId||branchId.length>128)return err(400,'Tipo ou filial inválidos.');
      const branch=await db.prepare('SELECT id FROM branches WHERE id=? AND tenant_id=? AND active=1').bind(branchId,tenantId).first();
      if(!branch)return err(400,'Filial inexistente ou inativa.');
      const count=await db.prepare('SELECT COUNT(*) AS total FROM r2_pairings WHERE tenant_id=? AND consumed_at IS NULL AND expires_at>?')
        .bind(tenantId,instant).first();
      if(Number(count?.total||0)>=8)return err(429,'Limite de pareamentos pendentes. Aguarde a expiração.');
      const code=newSessionToken(),id=uuid(),expiresAt=instant+5*60*1000;
      await db.prepare('INSERT INTO r2_pairings(id,tenant_id,branch_id,kind,code_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(id,tenantId,branchId,kind,await sha256(code),userId,instant,expiresAt).run();
      await audit(db,tenantId,userId,'pairing.created','pairing',id,instant);
      return json({pairingId:id,kind,branchId,expiresAt,code},201);
    }
    if(path==='lan/devices/pair'&&method==='POST'){
      const body=await parse(request),code=body?.code,name=String(body?.name||'').trim();
      if(typeof code!=='string'||!/^[a-f0-9]{64}$/.test(code)||!name||name.length>80)
        return err(400,'Código ou nome do dispositivo inválido.');
      const codeHash=await sha256(code);
      const intent=await db.prepare('SELECT * FROM r2_pairings WHERE code_hash=? AND tenant_id=?')
        .bind(codeHash,tenantId).first();
      if(!intent||intent.consumed_at!==null||intent.expires_at<=instant)
        return err(409,'Código consumido, expirado ou inválido.');
      if(!DEVICE_ROLES[intent.kind].has(member.profileKey))
        return err(403,'Perfil do operador incompatível com este dispositivo.');
      const activeBranch=await db.prepare('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1')
        .bind(tenantId,intent.branch_id).first();
      if(!activeBranch)return err(409,'Filial inativa.');
      const id=uuid(),credential=newSessionToken(),hash=await sha256(credential);
      // Both commands are one atomic transaction in D1 and the local SQLite adapter.
      // pairing_id UNIQUE prevents two devices from using the same code during races.
      const [inserted]=await db.batch([
        db.prepare('INSERT INTO r2_devices(id,tenant_id,branch_id,kind,name,user_id,pairing_id,credential_hash,created_at) SELECT ?,tenant_id,branch_id,kind,?,?,?,?,? FROM r2_pairings WHERE id=? AND tenant_id=? AND consumed_at IS NULL AND expires_at>?')
          .bind(id,name,userId,intent.id,hash,instant,intent.id,tenantId,instant),
        db.prepare('UPDATE r2_pairings SET consumed_at=? WHERE id=? AND tenant_id=? AND consumed_at IS NULL')
          .bind(instant,intent.id,tenantId)
      ]);
      if(Number(inserted?.meta?.changes||0)!==1)return err(409,'Código já utilizado.');
      await audit(db,tenantId,userId,'device.paired','device',id,instant);
      return json({device:{id,tenantId,branchId:intent.branch_id,kind:intent.kind,name,active:true},credential},201);
    }
    if(path==='lan/devices/check'&&method==='POST'){
      const body=await parse(request);
      const id=body?.id,credential=body?.credential;
      if(typeof id!=='string'||id.length>128||typeof credential!=='string'||!/^[a-f0-9]{64}$/.test(credential))
        return err(401,'Credencial inválida.');
      const row=await db.prepare('SELECT * FROM r2_devices WHERE id=? AND tenant_id=? AND user_id=? AND active=1')
        .bind(id,tenantId,userId).first();
      if(!row||await sha256(credential)!==row.credential_hash)
        return err(401,'Dispositivo não autorizado ou revogado.');
      await db.prepare('UPDATE r2_devices SET last_seen_at=? WHERE id=? AND tenant_id=? AND active=1')
        .bind(instant,id,tenantId).run();
      return json({device:mappedDevice({...row,last_seen_at:instant})});
    }
    if(parts.length===3&&parts[1]==='devices'&&method==='DELETE'){
      if(!owner)return err(403,'Somente o administrador revoga dispositivos.');
      const id=parts[2];
      const device=await db.prepare('SELECT id,active FROM r2_devices WHERE id=? AND tenant_id=?').bind(id,tenantId).first();
      if(!device)return err(404,'Dispositivo não encontrado.');
      if(device.active){
        await db.prepare('UPDATE r2_devices SET active=0,revoked_at=?,revoked_by=? WHERE id=? AND tenant_id=? AND active=1')
          .bind(instant,userId,id,tenantId).run();
        await audit(db,tenantId,userId,'device.revoked','device',id,instant);
      }
      return json({revoked:true,id});
    }
    if(path==='lan/readiness'&&method==='GET'){
      const {results}=await db.prepare('SELECT * FROM r2_readiness WHERE tenant_id=?').bind(tenantId).all();
      return json(viewReadiness(results));
    }
    if(parts.length===3&&parts[1]==='readiness'&&method==='PATCH'){
      if(!owner)return err(403,'Somente o administrador altera o checklist.');
      const key=parts[2],definition=R2_PILOT_CHECKS.find(item=>item.key===key);
      if(!definition)return err(404,'Verificação desconhecida.');
      const body=await parse(request),status=body?.status;
      if(!['NOT_STARTED','IN_PROGRESS','READY','BLOCKED','NOT_APPLICABLE'].includes(status))
        return err(400,'Estado inválido.');
      if(status==='NOT_APPLICABLE'&&!definition.optional)return err(400,'Verificação obrigatória.');
      const note=String(body.note||'').trim(),evidenceRef=String(body.evidenceRef||'').trim();
      if(note.length>500||evidenceRef.length>250)return err(400,'Evidência excede o tamanho permitido.');
      if(status==='READY'&&(note.length<12||evidenceRef.length<8))
        return err(400,'Informe descrição e referência verificável do ensaio.');
      await db.prepare('INSERT INTO r2_readiness(tenant_id,check_key,status,note,evidence_ref,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,check_key) DO UPDATE SET status=excluded.status,note=excluded.note,evidence_ref=excluded.evidence_ref,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
        .bind(tenantId,key,status,note,evidenceRef,userId,instant).run();
      await audit(db,tenantId,userId,'readiness.update','check',key,instant);
      return json({check:{...definition,status,note,evidenceRef,updatedAt:instant}});
    }
    if(path==='lan/diagnostics.zip'&&method==='GET'){
      if(!owner)return err(403,'Somente o administrador exporta diagnósticos.');
      // Explicit allowlist: never export users, sessions, passwords, raw logs,
      // LAN tokens, credential hashes or raw SQLite files.
      const [schema,devices,events]=await Promise.all([
        db.prepare('SELECT name FROM schema_migrations ORDER BY name').bind().all(),
        db.prepare('SELECT COUNT(*) AS n,SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active FROM r2_devices WHERE tenant_id=?').bind(tenantId).first(),
        db.prepare('SELECT action,target_type AS type,created_at AS createdAt FROM r2_audit WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(tenantId).all()
      ]);
      const diagnostic={
        'manifest.json':{format:'pdv-total-r2-support-v1',source:'self-hosted-lan',
          sanitized:true,generatedAt:new Date(instant).toISOString(),files:['manifest.json','health.json','migrations.json','audit.json']},
        'health.json':{database:'available',terminalCount:Number(devices?.n||0),activeTerminals:Number(devices?.active||0),
          migrationCount:schema.results.length,cloudRequired:false},
        'migrations.json':{applied:schema.results.map(row=>row.name)},
        'audit.json':{events:events.results}
      };
      const zip=zipJsonEntries(diagnostic,new Date(instant).toISOString());
      return new Response(zip,{status:200,headers:{'content-type':'application/zip',
        'content-disposition':'attachment; filename="pdv-total-lan-diagnostics.zip"',
        'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }
    if(path==='lan/audit'&&method==='GET'){
      if(!owner)return err(403,'Somente o administrador consulta o registro.');
      const {results}=await db.prepare('SELECT action,target_type AS targetType,target_id AS targetId,created_at AS createdAt FROM r2_audit WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 200')
        .bind(tenantId).all();
      return json({events:results});
    }
    if(path==='lan/health'&&method==='GET'){
      if(!owner)return err(403,'Somente o administrador consulta a saúde LAN.');
      const [deviceCount,pairCount]=await Promise.all([
        db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active FROM r2_devices WHERE tenant_id=?').bind(tenantId).first(),
        db.prepare('SELECT COUNT(*) AS pending FROM r2_pairings WHERE tenant_id=? AND consumed_at IS NULL AND expires_at>?').bind(tenantId,instant).first()
      ]);
      return json({ok:true,tenantId,devices:{total:Number(deviceCount?.total||0),active:Number(deviceCount?.active||0)},
        pendingPairings:Number(pairCount?.pending||0),core:'self-hosted',cloudRequired:false});
    }
    return err(404,'Rota LAN não encontrada.');
  }catch(error){
    if(error?.message?.includes('UNIQUE constraint')||error?.message?.includes('UNIQUE constraint failed'))
      return err(409,'Pareamento já consumido.');
    return err(500,'Falha na operação LAN.');
  }
}
