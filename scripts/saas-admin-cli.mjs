#!/usr/bin/env node
/**
 * Private operations for the PDV TOTAL SaaS. Never run this from a browser.
 * PLATFORM_ADMIN_TOKEN and owner credentials must be supplied via process env,
 * never through CLI flags, URLs or repository content.
 */
const endpoint=process.env.PDV_TOTAL_BASE_URL||'';
const token=process.env.PLATFORM_ADMIN_TOKEN||'';
const args=process.argv.slice(2);
const command=args[0];
function stop(message){console.error(message);process.exitCode=1;}
function getBase(){
 let url;try{url=new URL(endpoint);}catch{throw Error('Defina PDV_TOTAL_BASE_URL com a URL de produção HTTPS.');}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')
   throw Error('Use somente a origem HTTPS, sem usuário, rota ou query.');
 const loopback=['localhost','127.0.0.1'].includes(url.hostname);
 if(url.protocol!=='https:'&&!(loopback&&url.protocol==='http:'))
   throw Error('A administração exige HTTPS, exceto localhost.');
 return url.origin;
}
async function call(base,path,method='GET',body,secret=token,cookie=''){
 const headers={accept:'application/json'};
 if(secret)headers.authorization='Bearer '+secret;
 if(cookie)headers.cookie=cookie;
 if(method!=='GET'&&method!=='HEAD')headers.origin=base;
 if(body)headers['content-type']='application/json';
 const response=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 let data={};try{data=await response.json();}catch{}
 if(!response.ok){
  const e=new Error(data.error||('HTTP '+response.status));
  e.status=response.status;throw e;
 }
 return {response,data};
}
function requireSecret(){
 if(token.length<32)throw Error('Configure PLATFORM_ADMIN_TOKEN como variável privada (mínimo 32 caracteres).');
}
async function run(){
 const base=getBase();
 if(!['pending','approve','subscription','bootstrap','smoke'].includes(command))
  throw Error('Uso: saas-admin-cli.mjs pending | approve ID | subscription ID ESTADO PLANO EXPIRACAO_ISO | bootstrap | smoke');
 if(command==='smoke'){
  const email=process.env.PDV_OWNER_EMAIL,password=process.env.PDV_OWNER_PASSWORD;
  if(!email||!password)throw Error('Informe PDV_OWNER_EMAIL e PDV_OWNER_PASSWORD no ambiente para o smoke.');
  const {response, data}=await call(base,'/api/v1/auth/login','POST',{email,password},'');
  const cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!cookie||!data.memberships?.length)throw Error('Login sem cookie seguro ou empresa ativa.');
  const principal=await call(base,'/api/v1/auth/session','GET',undefined,'',cookie);
  if(principal.data.user?.email!==email.toLowerCase())throw Error('A sessão não corresponde à conta informada.');
  const tenantId=principal.data.memberships[0].tenantId;
  const p='/api/v1/tenants/'+encodeURIComponent(tenantId);
  const sub=await call(base,p+'/subscription','GET',undefined,'',cookie);
  const branches=await call(base,p+'/branches','GET',undefined,'',cookie);
  if(!branches.data.branches?.length)throw Error('Primeiro acesso sem filial ativa.');
  if(!sub.data.writeEnabled)throw Error('Assinatura inicial não habilita operação.');
  await call(base,'/api/v1/auth/session','DELETE',undefined,'',cookie);
  console.log('PASS — autenticação, sessão, tenant, filial e entitlement. Sessão de homologação revogada.');
  return;
 }
 requireSecret();
 if(command==='pending'){
  const {data}=await call(base,'/api/v1/platform/tenants');
  const list=(data.pendingTenants||[]).map(t=>({id:t.id,name:t.name,ownerEmail:t.ownerEmail,status:t.status,planKey:t.planKey}));
  console.log(JSON.stringify(list,null,2));return;
 }
 if(command==='approve'){
  if(!args[1]||!/^[-_a-zA-Z0-9]{1,128}$/.test(args[1]))throw Error('Informe um tenant ID válido.');
  const {data}=await call(base,'/api/v1/platform/tenants/'+encodeURIComponent(args[1])+'/approve','POST',{});
  console.log('Aprovação:',data.approved===true?'confirmada':'rejeitada','Tenant:',data.tenantId);
  return;
 }
 if(command==='subscription'){
  const [id,status,planKey,endsAt]=args.slice(1);
  if(!id||!/^[-_a-zA-Z0-9]{1,128}$/.test(id)||!status||!planKey||!endsAt)
    throw Error('Informe ID, estado, plano e vencimento ISO UTC.');
  const {data}=await call(base,'/api/v1/platform/tenants/'+encodeURIComponent(id)+'/subscription','PUT',
    {status,planKey,endsAt});
  console.log('Assinatura atualizada:',data.status, 'Tenant:',id);return;
 }
 if(command==='bootstrap'){
  const email=process.env.PDV_OWNER_EMAIL,password=process.env.PDV_OWNER_PASSWORD,
   ownerName=process.env.PDV_OWNER_NAME,slug=process.env.PDV_TENANT_SLUG,name=process.env.PDV_TENANT_NAME;
  if(!email||!password||!ownerName||!slug||!name)throw Error('Configure PDV_OWNER_EMAIL, PDV_OWNER_PASSWORD, PDV_OWNER_NAME, PDV_TENANT_SLUG e PDV_TENANT_NAME.');
  const {data}=await call(base,'/api/v1/platform/bootstrap','POST',
    {email,password,ownerName,slug,name});
  console.log('Primeiro estabelecimento provisionado:',data.created===true?'sim':'não','Tenant:',data.tenantId);
 }
}
run().catch(e=>stop('Operação abortada: '+String(e?.message||e)));
