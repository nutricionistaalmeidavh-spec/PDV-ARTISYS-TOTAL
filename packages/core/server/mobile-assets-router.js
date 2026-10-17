'use strict';

const fs=require('node:fs');
const path=require('node:path');

function createMobileAssetsRouter({mobileDir=path.join(__dirname,'mobile')}={}){
  const files=new Map([
    ['/mobile/manifest.webmanifest',['manifest.webmanifest','application/manifest+json; charset=utf-8']],
    ['/mobile/sw.js',['sw.js','application/javascript; charset=utf-8']],
    ['/mobile/pwa.js',['pwa.js','application/javascript; charset=utf-8']],
    ['/mobile/icon.svg',['icon.svg','image/svg+xml; charset=utf-8']],
    ['/mobile/order-composer.js',[path.join(__dirname,'..','shared','order-composer.js'),'application/javascript; charset=utf-8',true]]
  ]);
  return async function mobileAssetsRouter(request,response){
    if(request.method!=='GET')return false;const pathname=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`).pathname;const entry=files.get(pathname);if(!entry)return false;const full=entry[2]?entry[0]:path.join(mobileDir,entry[0]);if(!fs.existsSync(full)){response.writeHead(404,{'content-type':'text/plain; charset=utf-8'});response.end('Recurso mobile nao instalado.');return true;}const headers={'content-type':entry[1],'cache-control':entry[0]==='sw.js'?'no-cache':'private, max-age=3600'};if(entry[0]==='sw.js')headers['service-worker-allowed']='/mobile/';response.writeHead(200,headers);response.end(fs.readFileSync(full,'utf8'));return true;
  };
}

module.exports={createMobileAssetsRouter};
