import {readFileSync,writeFileSync,mkdirSync,chmodSync,mkdtempSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {homedir,tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createSpoolQueue,createBridgeServer} from './bridge.mjs';
import {sttyArgs} from './stty-args.mjs';
const exec=promisify(execFile);
const here=dirname(fileURLToPath(import.meta.url));
const configDir=resolve(process.env.PDV_BRIDGE_HOME||join(homedir(),'.pdv-total-bridge'));
const confFile=join(configDir,'bridge.json');
const origin=String(process.env.PDV_BRIDGE_ORIGIN||'').trim();
const printer=String(process.env.PDV_BRIDGE_PRINTER||'').trim();
const drawer=String(process.env.PDV_BRIDGE_DRAWER_PORT||'').trim();
if(!origin)throw new Error('Defina PDV_BRIDGE_ORIGIN com a origem HTTPS exata do seu PDV Total.');
if(printer.length>128)throw new Error('Nome da impressora muito longo.');
mkdirSync(configDir,{recursive:true,mode:0o700});
let conf;
try{conf=JSON.parse(readFileSync(confFile,'utf8'));}catch{}
if(!conf?.token||!/^[a-f0-9]{64}$/.test(conf.token)){
  conf={token:randomBytes(32).toString('hex')};
  writeFileSync(confFile,JSON.stringify(conf),{encoding:'utf8',mode:0o600,flag:'wx'});
}
try{chmodSync(confFile,0o600);}catch{}
async function spool({text}){
  const folder=mkdtempSync(join(tmpdir(),'pdv-total-print-'));
  const filename=join(folder,'comprovante.txt');
  try{
    writeFileSync(filename,text,{encoding:'utf8',mode:0o600});
    if(process.platform==='win32'){
      const args=['-NoLogo','-NoProfile','-NonInteractive','-File',join(here,'print.ps1'),filename,printer];
      await exec('powershell.exe',args,{windowsHide:true,timeout:15000,maxBuffer:1024*1024});
    }else{
      const args=printer?['-d',printer,filename]:[filename];
      await exec('lp',args,{timeout:15000,maxBuffer:1024*1024});
    }
  }finally{rmSync(folder,{recursive:true,force:true});}
}
async function openDrawer(){
  if(!drawer)throw Error('PDV_BRIDGE_DRAWER_PORT não configurada.');
  if(process.platform==='win32'){
    if(!/^COM([1-9]|[1-9][0-9])$/i.test(drawer))throw Error('Porta COM inválida.');
    await exec('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',join(here,'drawer.ps1'),drawer],
      {windowsHide:true,timeout:10000,maxBuffer:1024*1024});
  }else{
    if(!/^\/dev\/(ttyUSB\d+|ttyACM\d+|cu\.[A-Za-z0-9._-]{1,64})$/.test(drawer))throw Error('Porta serial não permitida.');
    // Serial drawer support on Unix depends on local device access and stty.
    const {openSync,writeSync,closeSync}=await import('node:fs');
    await exec('stty',sttyArgs(drawer),{timeout:5000});
    const fd=openSync(drawer,'w');try{writeSync(fd,Buffer.from([27,112,0,25,250]));}finally{closeSync(fd);}
  }
}
const queue=createSpoolQueue(join(configDir,'jobs.sqlite'),{spool});
const server=createBridgeServer({queue,origin,token:conf.token,drawerOpener:drawer?openDrawer:null});
server.listen(8765,'127.0.0.1',()=>{
  console.log('PDV Total: conector local disponível somente em http://127.0.0.1:8765');
  console.log('Origem autorizada:',origin);
  console.log('Código de pareamento deste computador:',conf.token);
  console.log('Impressora:',printer||'padrão do sistema','| Gaveta:',drawer?'configurada':'não configurada');
  console.log('Jobs enviados ao spooler não são confirmação física de impressão.');
});
function close(){server.close(()=>{queue.close();process.exit(0);});}
process.on('SIGINT',close);
process.on('SIGTERM',close);
