// Start the LAN server using PC-only credentials, never from browser JSON.
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const file=resolve('apps/api/.local/offline-profile.json');
try{
 if(!existsSync(file))throw Error('Execute npm run offline:setup antes de iniciar.');
 const raw=JSON.parse(readFileSync(file,'utf8'));
 if(raw.version!==1||!raw.env||raw.env.PDV_OFFLINE_REPLICA_ENABLED!=='true')
  throw Error('Perfil de gateway inválido.');
 if(!existsSync(resolve('dist/web/index.html')))
  throw Error('Interface não compilada. Execute npm run build.');
 const child=spawn(process.execPath,['--experimental-sqlite',resolve('apps/api/src/https-lan-server.mjs')],{
  env:{...process.env,...raw.env},stdio:'inherit',windowsHide:false});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 child.on('exit',(code)=>{process.exitCode=code||0;});
}catch(error){console.error('PDV Offline: '+error.message);process.exitCode=1;}
