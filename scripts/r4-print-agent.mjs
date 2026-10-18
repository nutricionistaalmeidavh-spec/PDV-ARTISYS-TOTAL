// Optional local print bridge. No cloud account, npm package or shell command needed.
// Authenticates with a dedicated kitchen operator; print jobs are scoped on the server.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export function renderKitchenTicket(job){
  if(!job||!job.payload||job.payload.jobFormat!=='R4_KITCHEN_V1'||!Array.isArray(job.payload.items))
    throw Error('Formato de ticket R4 inválido.');
  const printable=x=>String(x??'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,120);
  const lines=['=== PDV TOTAL / KDS ===',
    'Fila: '+printable(job.printerName),
    'Ticket: '+printable(job.id),
    'Pedido: '+printable(job.payload.orderId),
    ...(job.payload.ticketNumber?['Senha: '+printable(job.payload.ticketNumber)]:[]),
    '--------------------------------',
    ...job.payload.items.map(line=>printable(line.quantity)+' x '+printable(line.name)),
    '--------------------------------',
    'Impressão local / '+new Date().toISOString()];
  if(job.payload.items.length>80)throw Error('Ticket excede limite de itens.');
  return lines.join('\n')+'\n\n\n';
}

export function printerAllowed(printer,allowlist){
  return typeof printer==='string'&&printer.length>0&&printer.length<=120&&
    Array.isArray(allowlist)&&allowlist.includes(printer);
}

export async function spoolLocalPrinter(printer,text,{platform=process.platform,launch=spawn,timeoutMs=15000}={}){
  if(typeof printer!=='string'||!printer.trim()||printer.length>120)throw Error('Impressora inválida.');
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>16000)throw Error('Ticket inválido.');
  const windows=platform==='win32';
  // Never interpolate server-supplied printer names into commands. No shell.
  const program=windows?'powershell.exe':'lp';
  const args=windows?['-NoProfile','-NonInteractive','-Command','$input | Out-Printer -Name $env:PDV_AGENT_PRINTER']:['-d',printer];
  await new Promise((resolve,reject)=>{
    const child=launch(program,args,{shell:false,stdio:['pipe','ignore','pipe'],
      env:windows?{...process.env,PDV_AGENT_PRINTER:printer}:process.env});
    let stderr='',finished=false;
    const finish=error=>{
      if(finished)return;finished=true;clearTimeout(timeout);
      if(error)reject(error);else resolve();
    };
    const timeout=setTimeout(()=>{child.kill();finish(Error('Tempo de resposta da impressora esgotado.'));},timeoutMs);
    child.on('error',finish);
    child.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-500);});
    child.on('close',code=>finish(code===0?null:Error('Fila local recusou o ticket: '+stderr.slice(0,160))));
    child.stdin?.on('error',finish);
    child.stdin?.end(text,'utf8');
  });
}

async function run(){
  const env=process.env;
  const base=env.PDV_PRINT_API_ORIGIN,tenant=env.PDV_PRINT_TENANT,branch=env.PDV_PRINT_BRANCH;
  const email=env.PDV_PRINT_EMAIL,password=env.PDV_PRINT_PASSWORD;
  const allowlist=String(env.PDV_PRINTER_ALLOWLIST||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!base||!tenant||!branch||!email||!password||!allowlist.length)
    throw Error('Configure PDV_PRINT_API_ORIGIN, TENANT, BRANCH, EMAIL, PASSWORD e PDV_PRINTER_ALLOWLIST.');
  const origin=new URL(base);
  if(origin.pathname!=='/'||origin.search||origin.hash||
     !(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))
    throw Error('A API de impressão precisa usar HTTPS ou HTTP loopback local.');
  const login=await fetch(origin+'api/v1/auth/login',{method:'POST',
    headers:{'content-type':'application/json',origin:origin.origin},
    body:JSON.stringify({email,password})});
  if(!login.ok)throw Error('Login da impressão não autorizado.');
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  if(!cookie)throw Error('Sessão do operador não recebida.');
  const prefix=origin+'api/v1/tenants/'+encodeURIComponent(tenant)+'/restaurant/kitchen/print-jobs';
  const request=async(path='',method='GET',body=null)=>{
    const url=prefix+path+(path?'':'?branchId='+encodeURIComponent(branch));
    const res=await fetch(url,{method,headers:{cookie,origin:origin.origin,
      ...(body?{'content-type':'application/json','x-mutation-id':randomUUID()}: {})},
      ...(body?{body:JSON.stringify({branchId:branch,...body})}:{})});
    if(!res.ok)throw Error('Falha de autorização, conexão ou estado da API ('+res.status+').');
    return res.json();
  };
  const once=process.argv.includes('--once');
  let active=true;
  process.on('SIGTERM',()=>{active=false;});
  process.on('SIGINT',()=>{active=false;});
  console.info('Agente KDS conectado. Impressoras permitidas:',allowlist.length);
  do{
    const listing=await request();
    for(const job of (listing.jobs||[]).reverse()){
      if(!active)break;
      if(!printerAllowed(job.printerName,allowlist))continue;
      if(!['PENDING','FAILED'].includes(job.status)&&
         !(job.status==='LEASED'&&Date.parse(job.leasedUntil)<Date.now()))continue;
      let lease=null;
      try{lease=(await request('/'+encodeURIComponent(job.id)+'/claim','POST',{})).job;}
      catch{continue;} // Another terminal may have won.
      try{
        await spoolLocalPrinter(job.printerName,renderKitchenTicket(job));
        await request('/'+encodeURIComponent(job.id)+'/ack','POST',{leaseToken:lease.leaseToken,status:'PRINTED'});
        console.info('Ticket enviado à fila:',job.id);
      }catch(e){
        try{await request('/'+encodeURIComponent(job.id)+'/ack','POST',
          {leaseToken:lease.leaseToken,status:'FAILED',error:String(e.message||e).slice(0,160)});}
        catch{console.error('Confirmação de falha indisponível:',job.id);}
      }
    }
    if(!once&&active)await delay(15000);
  }while(!once&&active);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  run().catch(e=>{console.error('Agente KDS:',e.message);process.exitCode=1;});
