'use strict';

const { networkInterfaces } = require('node:os');
const { isIP } = require('node:net');

function lanAddresses(interfaces=networkInterfaces()) {
  return [...new Set(Object.entries(interfaces||{}).flatMap(([name,rows])=>/vpn|virtual|vethernet|vmware|virtualbox|docker|tailscale|zerotier|wireguard|tunnel|loopback/i.test(name)?[]:(rows||[]).filter(row=>row&&!row.internal&&row.active!==false&&row.operstate!=='down'&&isIP(row.address)===4&&!/^(127\.|169\.254\.|0\.|224\.|255\.)/.test(row.address)).map(row=>row.address)))];
}

function publicNetworkState({config={},lanEnabled=false,interfaces=networkInterfaces(),stableHost=''}={}) {
  if (['lan-client','own-server'].includes(config.mode)) {
    const url=new URL(config.serverUrl);
    return {enabled:true,remote:true,host:url.hostname,port:Number(url.port||(url.protocol==='https:'?443:80)),protocol:url.protocol,addresses:[url.hostname],baseUrl:url.origin};
  }
  const addresses=lanAddresses(interfaces);
  // A resolução mDNS feita no Windows não comprova acesso pelo iOS/Android.
  // Priorize IPv4 real nos QR Codes; .local continua disponível como opção avançada.
  const host=addresses[0]||'';const port=Number(config.port||4174);
  return {enabled:config.mode==='lan-host'&&lanEnabled&&Boolean(host),remote:false,host,stable:false,stableAvailable:Boolean(stableHost),stableHost:stableHost||'',addressMode:'ip',currentAddress:host,port,protocol:'http:',addresses,baseUrl:host?`http://${host}:${port}`:'',reason:config.mode!=='lan-host'?'Habilite este computador como PC principal em Configurações → Dados e servidor.':!lanEnabled?'O acesso pela rede não está ativo.':!host?'Conecte este computador à rede da loja.':''};
}

async function testPublicNetwork({state,host=state?.host,port=state?.port,fetchImpl=globalThis.fetch}={}) {
  if(!state?.enabled)throw new Error(state?.reason||'O acesso pela rede não está ativo.');
  const value=String(host||'').trim();
  if(!value||/[\s/@?#:]/.test(value))throw new Error('Selecione um endereço válido da rede da loja.');
  const number=Number(port);if(!Number.isInteger(number)||number<1||number>65535)throw new Error('Porta de rede inválida.');
  const baseUrl=`${state.protocol||'http:'}//${value}:${number}`;
  try {
    const response=await fetchImpl(`${baseUrl}/api/v1/health`,{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Resposta inválida do servidor.');
    const data=await response.json();
    if(data.ok!==true)throw new Error('O servidor não confirmou que está pronto.');
    return {ok:true,baseUrl,testedFrom:'pc-local',mobileConfirmed:false,message:'Servidor acessível a partir deste PC. Para comprovar acesso externo, confirme o teste no celular conectado ao Wi-Fi da loja.'};
  } catch {throw new Error('Não foi possível acessar o PC principal neste endereço. Confira a rede e a permissão do ArtiSys no Firewall do Windows.');}
}

module.exports={publicNetworkState,testPublicNetwork,lanAddresses};
