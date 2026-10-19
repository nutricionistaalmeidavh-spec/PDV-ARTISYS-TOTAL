// Optional billing adapter for the already independent pagamentos-artisys service.
// Never trusts a checkout redirect or webhook alone to grant access.
const out=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const sql=(db,text,...params)=>db.prepare(text).bind(...params);
const utf=value=>new TextEncoder().encode(value);
const hex=value=>Array.from(new Uint8Array(value),v=>v.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
export async function signHex(secret,input){
 const key=await crypto.subtle.importKey('raw',utf(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,utf(input)));
}
function encode(input){
 const bytes=utf(JSON.stringify(input));
 let text='';for(const x of bytes)text+=String.fromCharCode(x);
 return btoa(text).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function decode(input){
 const raw=atob(input.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-input.length%4)%4));
 return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
}
export async function createBinding(secret,{tenantId,userId,expiresAt}){
 if(typeof secret!=='string'||secret.length<32)throw Error('Billing binding secret not configured');
 const payload=encode({v:1,tenantId,userId,expiresAt});
 return payload+'.'+await signHex(secret,payload);
}
async function checkBinding(secret,ticket,now,allowExpired=false){
 if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{40,1200}\.[a-f0-9]{64}$/.test(ticket))return null;
 const [payload,sig]=ticket.split('.');
 if(!same(sig,await signHex(secret,payload)))return null;
 try{
  const value=decode(payload);
  if(value.v!==1||typeof value.tenantId!=='string'||typeof value.userId!=='string'||!Number.isSafeInteger(value.expiresAt)||(!allowExpired&&value.expiresAt<now))return null;
  return value;
 }catch{return null;}
}
const months=(date,n)=>{
 const d=new Date(date),day=d.getUTCDate();
 d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);
 const month=d.getUTCMonth(),year=d.getUTCFullYear();
 const max=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 d.setUTCDate(Math.min(day,max));return d.toISOString();
};
async function bodyJson(request){
 if(Number(request.headers.get('content-length')||0)>8192)throw Error('invalid_size');
 const raw=await request.text();if(raw.length>8192)throw Error('invalid_size');
 const value=JSON.parse(raw);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('invalid_json');
 return value;
}
function config(env){
 const secret=env.ARTISYS_BILLING_SECRET,bindingSecret=env.ARTISYS_BINDING_SECRET||secret;
 if(env.ARTISYS_BILLING_ENABLED!=='true'||typeof secret!=='string'||secret.length<32||typeof bindingSecret!=='string'||bindingSecret.length<32)return null;
 return {secret,bindingSecret};
}
function serviceUrl(env){
 const input=env.ARTISYS_PAYMENTS_URL||'https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev';
 const url=new URL(input);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.port)return null;
 if(!/^(?:[a-z0-9-]+\.)*(?:artisys\.dev|workers\.dev)$/.test(url.hostname))return null;
 return url.origin;
}
function validCheckout(url){
 try{const u=new URL(url);return u.protocol==='https:'&&['asaas.com','sandbox.asaas.com'].includes(u.hostname)&&u.pathname.startsWith('/checkoutSession/')&&!u.username&&!u.password;}catch{return false;}
}
async function offers(env,fetchImpl){
 const base=serviceUrl(env);if(!base)return null;
 const resp=await fetchImpl(base+'/v1/catalog',{headers:{accept:'application/json'},redirect:'error'});
 if(!resp.ok)throw Error('catalog_unavailable');
 const data=await resp.json();
 const all=Array.isArray(data.offers)?data.offers:[];
 return ['monthly','yearly'].map(period=>{
  const offerId=env[period==='monthly'?'ARTISYS_PDV_MONTHLY_OFFER_ID':'ARTISYS_PDV_YEARLY_OFFER_ID'];
  const value=all.find(v=>v.id===offerId&&v.productId==='pdv-total-saas'&&v.saleType===period&&v.deliveryMode==='webhook'&&Number.isInteger(v.priceCents)&&v.priceCents>0);
  return value?{period,offerId,amountCents:value.priceCents,currency:'BRL',name:value.name}:null;
 }).filter(Boolean);
}
export async function billingCustomerRoute(request,db,env,session,member,tenantId,path,now,{fetchImpl=fetch}={}){
 if(!['billing/plans','billing/checkout','billing/orders'].includes(path))return null;
 if(member.profileKey!=='OWNER')return out({error:'Somente o proprietário pode gerenciar cobranças.'},403);
 const cfg=config(env);if(!cfg)return out({error:'Cobrança ArtiSys opcional não configurada.'},503);
 try{
  if(path==='billing/orders'&&request.method==='GET'){
   const {results}=await sql(db,'SELECT order_id AS orderId,plan_key AS period,amount_cents AS amountCents,checkout_url AS checkoutUrl,created_at AS createdAt FROM saas_billing_orders WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50',tenantId).all();
   return out({orders:results});
  }
  if(path==='billing/plans'&&request.method==='GET')return out({plans:await offers(env,fetchImpl),provider:'ArtiSys / Asaas'});
  if(path!=='billing/checkout'||request.method!=='POST')return out({error:'Método não permitido.'},405);
  const input=await bodyJson(request),period=input.period,coupon=String(input.couponCode||'').toUpperCase().trim(),idem=input.idempotencyKey;
  if(!['monthly','yearly'].includes(period)||!/^$|^[A-Z0-9_-]{3,40}$/.test(coupon)||typeof idem!=='string'||!/^[A-Za-z0-9_-]{16,120}$/.test(idem))
   return out({error:'Plano, cupom ou idempotência inválidos.'},400);
  const old=await sql(db,'SELECT checkout_url AS checkoutUrl,order_id AS orderId FROM saas_billing_orders WHERE tenant_id=? AND idempotency_key=?',tenantId,idem).first();
  if(old)return out({...old,reused:true});
  const list=await offers(env,fetchImpl),offer=list?.find(v=>v.period===period);
  if(!offer)return out({error:'Oferta não publicada na central ArtiSys.'},503);
  const owner=await sql(db,'SELECT email_norm AS email,display_name AS name FROM users WHERE id=? AND active=1',session.userId).first();
  if(!owner)return out({error:'Proprietário não encontrado.'},403);
  const ticket=await createBinding(cfg.bindingSecret,{tenantId,userId:session.userId,expiresAt:now+3*86400000});
  const base=serviceUrl(env),order=await fetchImpl(base+'/v1/orders',{method:'POST',redirect:'error',
   headers:{'content-type':'application/json','idempotency-key':idem},body:JSON.stringify({offerId:offer.offerId,email:owner.email,name:owner.name,couponCode:coupon||undefined,buyerBinding:ticket})});
  if(!order.ok)return out({error:order.status===400?'Cupom inválido ou compra rejeitada.':'Não foi possível criar a compra.',gatewayStatus:order.status},502);
  const created=await order.json(),id=created.order?.id,access=created.orderAccessToken;
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||typeof access!=='string'||!Number.isInteger(created.order?.amountCents)||created.order.amountCents<1)return out({error:'Resposta de compra inválida.'},502);
  const checkout=await fetchImpl(base+'/v1/orders/'+id+'/checkout',{method:'POST',redirect:'error',
   headers:{'content-type':'application/json',authorization:'Bearer '+access},body:JSON.stringify({provider:'asaas'})});
  if(!checkout.ok)return out({error:'Checkout não confirmado. Verifique a conciliação na central de pagamentos antes de repetir.',gatewayStatus:checkout.status},502);
  const result=await checkout.json(),checkoutUrl=result.checkoutUrl;
  if(!validCheckout(checkoutUrl))return out({error:'Checkout não autorizado.'},502);
  await sql(db,'INSERT INTO saas_billing_orders(order_id,tenant_id,owner_user_id,offer_id,plan_key,amount_cents,checkout_url,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
   id,tenantId,session.userId,offer.offerId,period,created.order.amountCents,checkoutUrl,idem,new Date(now).toISOString()).run();
  return out({orderId:id,checkoutUrl,amountCents:created.order.amountCents,period},201);
 }catch{return out({error:'Falha ao consultar a central de pagamentos. Nenhum acesso foi liberado.'},502);}
}
export async function billingConnectorRoute(request,db,env,now){
 const cfg=config(env);if(!cfg)return out({error:'Conector desativado.'},503);
 if(request.method!=='POST')return out({error:'Método inválido.'},405);
 const timestamp=request.headers.get('x-artisys-timestamp')||'',signature=request.headers.get('x-artisys-signature')||'';
 if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300000)return out({error:'Assinatura inválida.'},401);
 let raw;
 try{raw=await request.text();}catch{return out({error:'Requisição inválida.'},400);}
 if(raw.length>8192||!same(signature,'sha256='+await signHex(cfg.secret,timestamp+'.'+raw)))return out({error:'Assinatura inválida.'},401);
 let body;try{body=JSON.parse(raw);}catch{return out({error:'JSON inválido.'},400);}
 const kind=({'artisys.license.activate':'activate','artisys.license.renew':'renew','artisys.license.revoke':'revoke'})[body?.event];
 const delivery=request.headers.get('x-artisys-delivery-id');
 if(!kind||typeof delivery!=='string'||delivery!==body.idempotencyKey||delivery.length>128||!/^[-a-zA-Z0-9_]{1,128}$/.test(delivery)||body.productId!=='pdv-total-saas'||body.currency!=='BRL')
  return out({error:'Entrega incompatível.'},400);
 const existing=await sql(db,'SELECT delivery_id FROM saas_billing_deliveries WHERE delivery_id=?',delivery).first();
 if(existing)return out({accepted:true,duplicate:true});
 const order=await sql(db,'SELECT * FROM saas_billing_orders WHERE order_id=?',body.orderId||'').first();
 if(!order||body.saleType!==order.plan_key||body.amountCents!==order.amount_cents||typeof body.email!=='string')
  return out({error:'Compra não corresponde ao estabelecimento.'},409);
 const user=await sql(db,"SELECT u.email_norm AS email FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE m.tenant_id=? AND u.id=? AND m.profile_key='OWNER' AND m.active=1 AND u.active=1",
  order.tenant_id,order.owner_user_id).first();
 if(!user||user.email!==body.email)return out({error:'Identidade do pagador divergente.'},409);
 const binding=await checkBinding(cfg.bindingSecret,body.buyerBinding,now,kind!=='activate');
 if(!binding||binding.tenantId!==order.tenant_id||binding.userId!==order.owner_user_id)return out({error:'Vínculo de empresa inválido.'},409);
 const count=await sql(db,"SELECT COUNT(*) AS n FROM saas_billing_deliveries WHERE order_id=? AND event_kind='activate'",order.order_id).first();
 if(kind==='activate'&&count.n>0)return out({error:'Ativação já realizada para este pedido.'},409);
 const current=await sql(db,'SELECT ends_at AS endsAt,updated_by AS updatedBy FROM saas_subscriptions WHERE tenant_id=?',order.tenant_id).first();
 const stamp=new Date(now).toISOString(),owner='BILLING:'+order.order_id;
 let statements=[sql(db,'INSERT INTO saas_billing_deliveries(delivery_id,order_id,event_kind,created_at) VALUES(?,?,?,?)',delivery,order.order_id,kind,stamp)];
 if(kind==='activate'||kind==='renew'){
  const base=Math.max(now,Date.parse(current?.endsAt)||0);
  const endsAt=months(base,order.plan_key==='monthly'?1:12);
  statements.push(sql(db,"INSERT INTO saas_subscriptions(tenant_id,plan_key,status,ends_at,updated_at,updated_by) VALUES(?,?,'ACTIVE',?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET plan_key=excluded.plan_key,status=excluded.status,ends_at=excluded.ends_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by,version=saas_subscriptions.version+1",
   order.tenant_id,order.plan_key,endsAt,stamp,owner));
 }else if(current?.updatedBy===owner){
  statements.push(sql(db,"UPDATE saas_subscriptions SET status='SUSPENDED',updated_at=?,version=version+1 WHERE tenant_id=? AND updated_by=?",stamp,order.tenant_id,owner));
 }
 statements.push(sql(db,'INSERT INTO saas_audit_events(id,tenant_id,actor_id,kind,subject_id,created_at,detail_json) VALUES(?,?,?,?,?,?,?)',
  crypto.randomUUID(),order.tenant_id,'ARTISYS_BILLING','BILLING_'+kind.toUpperCase(),order.order_id,stamp,JSON.stringify({deliveryId:delivery})));
 try{await db.batch(statements);return out({accepted:true});}
 catch{
  const found=await sql(db,'SELECT delivery_id FROM saas_billing_deliveries WHERE delivery_id=?',delivery).first();
  return found?out({accepted:true,duplicate:true}):out({error:'Entrega ainda não persistida.'},503);
 }
}
