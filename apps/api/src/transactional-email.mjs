// Optional transactional email transport. Native Cloudflare Email Service takes
// priority on Workers; self-hosted installations remain independent of it.
const email=/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
export const emailTransportPresent=env=>Boolean(env?.EMAIL?.send||env?.EMAIL_DELIVERY_URL||env?.EMAIL_DELIVERY_TOKEN);
export const emailTransportReady=env=>Boolean(
 (typeof env?.EMAIL?.send==='function'&&email.test(String(env?.EMAIL_FROM||'')))||
 (typeof env?.EMAIL_DELIVERY_URL==='string'&&typeof env?.EMAIL_DELIVERY_TOKEN==='string'&&env.EMAIL_DELIVERY_TOKEN.length>=32)
);
export async function sendTransactionalEmail(env,{to,subject,text,link},{fetchImpl=fetch}={}){
 if(typeof to!=='string'||!email.test(to)||typeof subject!=='string'||/\r|\n/.test(subject)||
  typeof text!=='string'||!text||text.length>16000)throw Error('Invalid email payload');
 if(typeof env?.EMAIL?.send==='function'){
  if(!email.test(String(env.EMAIL_FROM||'')))throw Error('EMAIL_FROM_NOT_CONFIGURED');
  const response=await env.EMAIL.send({to,from:{name:'ArtiSys PDV Total',email:env.EMAIL_FROM},subject,text});
  if(!response?.messageId)throw Error('EMAIL_SEND_UNCONFIRMED');
  return {delivered:true,messageId:response.messageId};
 }
 if(!emailTransportReady(env))throw Error('EMAIL_TRANSPORT_NOT_CONFIGURED');
 const uri=new URL(env.EMAIL_DELIVERY_URL);
 if(uri.protocol!=='https:'||uri.username||uri.password||uri.hash)throw Error('INVALID_EMAIL_BRIDGE_URL');
 const r=await fetchImpl(uri.href,{method:'POST',headers:{
  authorization:'Bearer '+env.EMAIL_DELIVERY_TOKEN,'content-type':'application/json'},
  body:JSON.stringify({to,subject,text,...(link?{link}:{})}),redirect:'error'});
 if(!r.ok)throw Error('EMAIL_BRIDGE_FAILED');
 return {delivered:true};
}
