import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {timingSafeEqual,createHash} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';

const now=()=>new Date().toISOString();
const idPattern=/^[A-Za-z0-9_-]{8,100}$/;
const salePattern=/^[A-Za-z0-9_-]{4,120}$/;
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const external=row=>row?{
  id:row.id,saleId:row.sale_id,status:row.status,
  attempts:row.attempts,createdAt:row.created_at,updatedAt:row.updated_at,
  error:row.last_error||null
}:null;
function validateJob(body){
  const id=body?.id,saleId=body?.saleId,text=body?.text;
  if(!idPattern.test(String(id||''))||!salePattern.test(String(saleId||'')))
    throw Object.assign(new Error('Identificador de impressão inválido.'),{status:400});
  if(typeof text!=='string'||!text.trim()||text.length>14000||/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text))
    throw Object.assign(new Error('Texto do comprovante inválido.'),{status:400});
  return {id,saleId,text};
}
export function createSpoolQueue(file,{spool}={}){
  if(typeof spool!=='function')throw new TypeError('Driver local de impressão obrigatório.');
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const db=new DatabaseSync(file);
  try{chmodSync(file,0o600);}catch{}
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  db.exec("CREATE TABLE IF NOT EXISTS bridge_jobs("+
    "id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,body_hash TEXT NOT NULL,body_text TEXT NOT NULL,"+
    "status TEXT NOT NULL CHECK(status IN('PENDING','SUBMITTING','SUBMITTED','FAILED','UNCERTAIN')),"+
    "attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT);"+
    "CREATE INDEX IF NOT EXISTS idx_bridge_jobs_created ON bridge_jobs(created_at DESC);");
  // A crash between spooler submission and acknowledgement has ambiguous physical result.
  // Never silently replay an ambiguous receipt after restart.
  db.prepare("UPDATE bridge_jobs SET status='UNCERTAIN',last_error='Resultado do envio incerto após reinício.',updated_at=? WHERE status='SUBMITTING'").run(now());
  const inflight=new Map();
  const raw=id=>db.prepare('SELECT * FROM bridge_jobs WHERE id=?').get(id);
  const get=id=>external(raw(String(id)));
  const list=()=>db.prepare('SELECT * FROM bridge_jobs ORDER BY created_at DESC,id DESC LIMIT 50').all().map(external);
  async function dispatch(id){
    if(inflight.has(id))return inflight.get(id);
    const run=async()=>{
      const entry=raw(id);
      if(!entry)throw Object.assign(new Error('Trabalho não encontrado.'),{status:404});
      if(!['PENDING','FAILED'].includes(entry.status))return external(entry);
      db.prepare("UPDATE bridge_jobs SET status='SUBMITTING',attempts=attempts+1,updated_at=?,last_error=NULL WHERE id=? AND status IN('PENDING','FAILED')").run(now(),id);
      try{
        // A spooler exit code confirms submission, not a physical print.
        await spool({id:entry.id,saleId:entry.sale_id,text:entry.body_text});
        db.prepare("UPDATE bridge_jobs SET status='SUBMITTED',updated_at=? WHERE id=? AND status='SUBMITTING'").run(now(),id);
      }catch(e){
        db.prepare("UPDATE bridge_jobs SET status='FAILED',updated_at=?,last_error=? WHERE id=? AND status='SUBMITTING'").run(now(),String(e?.message||'Falha ao enviar ao spooler').slice(0,240),id);
      }
      return get(id);
    };
    const promise=run().finally(()=>inflight.delete(id));
    inflight.set(id,promise);
    return promise;
  }
  async function submit(input){
    const value=validateJob(input),hash=digest(value.saleId+'\n'+value.text);
    const prior=raw(value.id);
    if(prior){
      if(prior.body_hash!==hash)
        throw Object.assign(new Error('ID existente com conteúdo diferente.'),{status:409});
      return inflight.has(value.id)?inflight.get(value.id):external(prior);
    }
    const stamp=now();
    db.prepare("INSERT INTO bridge_jobs(id,sale_id,body_hash,body_text,status,created_at,updated_at) VALUES(?,?,?,?,'PENDING',?,?)")
      .run(value.id,value.saleId,hash,value.text,stamp,stamp);
    return dispatch(value.id);
  }
  async function retry(id){
    const row=raw(String(id));
    if(!row)throw Object.assign(new Error('Trabalho não encontrado.'),{status:404});
    if(row.status==='UNCERTAIN'||row.status==='SUBMITTING')
      throw Object.assign(new Error('Resultado de impressão incerto: confira a impressora antes de emitir nova via.'),{status:409});
    if(row.status!=='FAILED'&&row.status!=='PENDING')
      throw Object.assign(new Error('Reenvio permitido somente após falha confirmada.'),{status:409});
    return dispatch(row.id);
  }
  return Object.freeze({db,submit,retry,get,list,close:()=>db.close()});
}
function json(res,status,data,headers={}){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});
  res.end(JSON.stringify(data));
}
function matchesToken(supplied,expected){
  if(typeof supplied!=='string'||!supplied.startsWith('Bearer '))return false;
  const received=Buffer.from(supplied.slice(7));
  const secret=Buffer.from(expected);
  return received.length===secret.length&&timingSafeEqual(received,secret);
}
function originHeader(origin){
  return {
    'access-control-allow-origin':origin,
    'vary':'Origin',
    'access-control-allow-methods':'GET,POST,OPTIONS',
    'access-control-allow-headers':'authorization,content-type',
    'access-control-allow-private-network':'true',
    'access-control-max-age':'600'
  };
}
export function createBridgeServer({queue,origin,token,drawerOpener=null}={}){
  if(!queue||!origin||!token||token.length<32)throw new Error('Fila, origem HTTPS e token forte obrigatórios.');
  const u=new URL(origin);
  if(u.origin!==origin||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))
    throw new Error('Origem do PDV inválida; use HTTPS.');
  const server=createServer(async(req,res)=>{
    // Bind only 127.0.0.1 in the entrypoint; Host check mitigates DNS rebinding.
    const host=req.headers.host||'';
    if(!/^((127\.0\.0\.1)|(localhost)):\d+$/.test(host))return json(res,403,{error:'Destino local inválido.'});
    if(req.headers.origin!==origin)return json(res,403,{error:'Origem não autorizada.'});
    const cors=originHeader(origin);
    if(req.method==='OPTIONS'){res.writeHead(204,cors);res.end();return;}
    if(!matchesToken(req.headers.authorization,token))return json(res,401,{error:'Dispositivo não pareado.'},cors);
    const url=new URL(req.url,'http://127.0.0.1');
    try{
      if(req.method==='GET'&&url.pathname==='/v1/status')
        return json(res,200,{service:'pdv-total-local',ready:true,version:1},cors);
      if(req.method==='GET'&&url.pathname==='/v1/jobs')
        return json(res,200,{jobs:queue.list()},cors);
      const retry=url.pathname.match(/^\/v1\/jobs\/([A-Za-z0-9_-]{8,100})\/retry$/);
      if(req.method==='POST'&&retry)return json(res,200,{job:await queue.retry(retry[1])},cors);
      if(req.method==='POST'&&url.pathname==='/v1/drawer/open'){
        if(!drawerOpener)return json(res,501,{error:'Gaveta sem driver local configurado.'},cors);
        await drawerOpener();
        return json(res,200,{commandSubmitted:true,physicalConfirmation:false},cors);
      }
      if(req.method==='POST'&&url.pathname==='/v1/print'){
        if(!String(req.headers['content-type']||'').startsWith('application/json'))
          return json(res,415,{error:'JSON obrigatório.'},cors);
        let count=0,raw='';
        for await(const chunk of req){
          count+=chunk.length;
          if(count>20000)return json(res,413,{error:'Pedido muito grande.'},cors);
          raw+=chunk.toString('utf8');
        }
        let input;try{input=JSON.parse(raw);}catch{return json(res,400,{error:'JSON inválido.'},cors);}
        return json(res,200,{job:await queue.submit(input)},cors);
      }
      return json(res,404,{error:'Operação não suportada.'},cors);
    }catch(e){return json(res,e.status||500,{error:e.status?e.message:'Erro local ao processar comando.'},cors);}
  });
  return server;
}
