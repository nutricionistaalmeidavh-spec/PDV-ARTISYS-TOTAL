import {readFileSync,writeFileSync,mkdirSync,chmodSync,mkdtempSync,rmSync,renameSync} from 'node:fs';
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
mkdirSync(configDir,{recursive:true,mode:0o700});
let conf={};
try{conf=JSON.parse(readFileSync(confFile,'utf8'))||{};}catch{}
const fixedPrinter=String(process.env.PDV_BRIDGE_PRINTER||'').trim();
const origin=String(process.env.PDV_BRIDGE_ORIGIN||conf.origin||'').trim();
let printer=String(fixedPrinter||conf.printer||'').trim();
const drawer=String(process.env.PDV_BRIDGE_DRAWER_PORT||'').trim();
if(!origin)throw new Error('Configure a origem HTTPS do PDV Total durante a instalação ou em PDV_BRIDGE_ORIGIN.');
if(printer.length>128)throw new Error('Nome da impressora muito longo.');
function persist(){
  const tmp=confFile+'.tmp-'+process.pid+'-'+randomBytes(5).toString('hex');
  writeFileSync(tmp,JSON.stringify(conf),{encoding:'utf8',mode:0o600,flag:'wx'});
  try{renameSync(tmp,confFile);}finally{try{rmSync(tmp,{force:true});}catch{}}
  try{chmodSync(confFile,0o600);}catch{}
}
if(!/^[a-f0-9]{64}$/.test(conf.token||''))conf.token=randomBytes(32).toString('hex');
if(conf.origin!==origin||!conf.token||conf.printer===undefined){conf.origin=origin;conf.printer=printer;persist();}
else{try{chmodSync(confFile,0o600);}catch{}}
async function listPrinters(){
  if(process.platform!=='win32')return {printers:[],selected:printer,note:'Detecção automática disponível nesta versão para Windows.'};
  const {stdout}=await exec('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',
    'Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress'],{windowsHide:true,timeout:12000,maxBuffer:1024*1024});
  const parsed=stdout.trim()?JSON.parse(stdout):[];
  const entries=(Array.isArray(parsed)?parsed:[parsed]).filter(x=>typeof x?.Name==='string'&&x.Name.length>0&&x.Name.length<=128)
    .map(x=>({name:x.Name,isDefault:x.Default===true}));
  return {printers:entries,selected:printer};
}
async function selectPrinter(name){
  if(fixedPrinter)throw Object.assign(Error('A impressora foi fixada pela configuração avançada deste computador.'),{status:409});
  const inventory=await listPrinters();
  if(name!==''&&!inventory.printers.some(p=>p.name===name))
    throw Object.assign(Error('Impressora não encontrada.'),{status:400});
  printer=name;conf.printer=name;persist();
  return {selected:printer};
}
async function authorizeOnWindows(){
  if(process.platform!=='win32')return false;
  const command='$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.Windows.Forms; '+
    '$answer=[System.Windows.Forms.MessageBox]::Show('+
    '("Permitir que o PDV Total ("+$env:PDV_PAIRING_ORIGIN+") use a impressora deste computador?"),'+
    '"Autorizar impressão local",[System.Windows.Forms.MessageBoxButtons]::YesNo,'+
    '[System.Windows.Forms.MessageBoxIcon]::Question); if($answer -eq "Yes"){"AUTHORIZED"}else{"DENIED"}';
  const {stdout}=await exec('powershell.exe',['-NoLogo','-NoProfile','-STA','-Command',command],{
    env:{...process.env,PDV_PAIRING_ORIGIN:origin},windowsHide:false,timeout:45000,maxBuffer:65536});
  return stdout.trim()==='AUTHORIZED';
}
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
const server=createBridgeServer({queue,origin,token:conf.token,drawerOpener:drawer?openDrawer:null,
  pairAuthorizer:process.platform==='win32'?authorizeOnWindows:null,
  printerControl:{list:listPrinters,select:selectPrinter}});
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
