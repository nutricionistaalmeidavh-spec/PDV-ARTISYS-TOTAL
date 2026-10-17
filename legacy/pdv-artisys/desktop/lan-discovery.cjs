'use strict';
const {createHash}=require('node:crypto');
const {lookup}=require('node:dns').promises;
const {lanAddresses}=require('./public-network.cjs');

function stableHostname(identity){return `artisys-${createHash('sha256').update(String(identity)).digest('hex').slice(0,10)}.local`;}
function createLanDiscovery({identity,port,displayName='PC principal ArtiSys',interfaces,resolve=lookup,bonjourFactory}={}){
  const hostname=stableHostname(identity);let bonjour=null,service=null,signature='',ready=false,closed=false;
  function refresh(){
    if(closed)return;
    const addresses=lanAddresses(interfaces?.());const next=addresses.join(',');
    if(next===signature&&service)return;
    signature=next;ready=false;
    service?.stop();service=null;
    if(!addresses.length)return;
    try{
      bonjour ||= bonjourFactory?bonjourFactory():new (require('bonjour-service').Bonjour)({},()=>{ready=false;});
      bonjour.server?.mdns?.on('error',()=>{ready=false;});
      service=bonjour.publish({name:hostname.replace('.local',''),host:hostname,type:'http',port,disableIPv6:true,txt:{product:'ArtiSys',role:'principal',displayName:String(displayName||'PC principal ArtiSys').slice(0,80),path:'/mobile'}});
      const original=service.records.bind(service);
      service.records=()=>original().filter(record=>record.type!=='A'&&record.type!=='AAAA').concat(addresses.map(address=>({name:hostname,type:'A',ttl:30,data:address})));
      const published=service;
      service.on('up',()=>{if(service===published)ready=true;});
      service.on('error',()=>{ready=false;});
    }catch{ready=false;}
  }
  refresh();const timer=setInterval(refresh,5000);timer.unref?.();
  async function state(){
    refresh();if(!ready)return '';
    try{const result=await Promise.race([resolve(hostname,{all:true,family:4}),new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('DNS timeout')),1500);timeout.unref?.();})]);const valid=lanAddresses(interfaces?.());return result.length&&result.every(row=>valid.includes(row.address))?hostname:'';}catch{return '';}
  }
  function stop(){closed=true;clearInterval(timer);service?.stop();bonjour?.destroy();service=null;ready=false;}
  return {hostname,state,refresh,stop};
}
function normalizeDiscoveredServer(service={}){
  const txt=service&&typeof service.txt==='object'&&service.txt?service.txt:{};
  if(String(txt.product||'').trim().toLowerCase()!=='artisys')return null;
  if(txt.role&&String(txt.role).trim().toLowerCase()!=='principal')return null;
  const port=Number(service.port);
  if(!Number.isInteger(port)||port<1||port>65535)return null;
  const addresses=[...new Set((Array.isArray(service.addresses)?service.addresses:[]).map(value=>String(value||'').trim()).filter(value=>/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)&&!value.startsWith('127.')&&!value.startsWith('169.254.')))];
  let host=String(service.host||'').trim().replace(/\.$/,'');
  if(!host)host=addresses[0]||'';
  if(!host||host==='localhost'||host.startsWith('127.'))return null;
  const name=String(txt.displayName||'PC principal ArtiSys').trim().slice(0,80)||'PC principal ArtiSys';
  return{id:`${host}:${port}`,name,host,port,url:`http://${host}:${port}`,addresses};
}

async function discoverLanServers({timeoutMs=1200,bonjourFactory}={}){
  const bonjour=bonjourFactory?bonjourFactory():new (require('bonjour-service').Bonjour)();
  const found=new Map();let browser=null;
  const add=service=>{const item=normalizeDiscoveredServer(service);if(item)found.set(item.id,item);};
  try{
    browser=bonjour.find({type:'http'},add);
    browser?.on?.('up',add);
    await new Promise(resolve=>setTimeout(resolve,Math.max(50,Number(timeoutMs)||1200)));
  }finally{
    try{browser?.stop?.();}catch{}
    try{bonjour?.destroy?.();}catch{}
  }
  return[...found.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.url.localeCompare(b.url));
}
module.exports={stableHostname,createLanDiscovery,normalizeDiscoveredServer,discoverLanServers};
