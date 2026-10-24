import {mkdirSync,cpSync,copyFileSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildPwaIcons} from './pwa-icons.mjs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,'apps/web'),output=resolve(root,'dist/web');
const allow=new Set(['.html','.css','.js','.svg','.png','.webp','.ico','.webmanifest']);
rmSync(output,{recursive:true,force:true});mkdirSync(output,{recursive:true});
cpSync(source,output,{recursive:true,filter:(path)=>path===source||!extname(path)||allow.has(extname(path))});
const filename=resolve(output,'index.html');
let html=readFileSync(filename,'utf8');
html=html.replace("connect-src 'none'","connect-src 'self' http://127.0.0.1:8765");
html=html.replace('<title>ArtiSys PDV</title>','<title>PDV Total | ArtiSys</title>');
html=html.replace("../../packages/core/shared/order-composer.js","./order-composer.js");
html=html.replace("../../packages/core/js/core/mobile-access/qr-code.js","./local-access-qr.js");
for(const desktopScript of ['first-access-ui.js','updater-ui.js','hardware-scale-ui.js','telemetry-ui.js','reload-transition-ui.js']){
  html=html.replace(new RegExp('\\s*<script defer src="\\./'+desktopScript.replaceAll('.','\\.')+'"></script>','g'),'');
}
html=html.replace('ArtiSys PDV</h1><p>Inicializando sistema local...','PDV Total</h1><p>Conectando ao seu estabelecimento...');
html=html.replace('<div class="window-controls" aria-label="Controles da janela">','<div class="window-controls" hidden aria-label="Controles da janela">');
html=html.replace('<span>Rede Local</span>','<span>Servidor PDV</span>').replace('Sistema local</span>','Conectado ao servidor</span>');
html=html.replace('</head>',`  <meta name="theme-color" content="#081a35" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icons/pdv-total-192.png" />
  <link rel="stylesheet" href="./web-cloud.css" />
</head>`);
html=html.replace('<body class="theme-home">','<body class="theme-home"><div id="web-offline-alert" role="status" aria-live="polite">Sem conexão com o servidor. Consultas e vendas precisam do servidor disponível na rede; nenhuma operação será enviada automaticamente.</div>');
html=html.replace('</body>','  <script defer src="./pwa-register.js"></script>\n</body>');
// The operating system remains the only app shell at /app/.
// / serves the public landing; both share the same origin, API and cookie.
const appEntry=resolve(output,'app/index.html');
mkdirSync(dirname(appEntry),{recursive:true});
writeFileSync(appEntry,html.replace('<head>','<head>\n  <base href="/" />'),'utf8');
copyFileSync(resolve(root,'apps/landing/index.html'),filename);
copyFileSync(resolve(root,'apps/landing/landing.css'),resolve(output,'landing.css'));
copyFileSync(resolve(root,'apps/landing/landing-auth.css'),resolve(output,'landing-auth.css'));
copyFileSync(resolve(root,'apps/landing/landing-premium.css'),resolve(output,'landing-premium.css'));
copyFileSync(resolve(root,'apps/landing/landing-motion.js'),resolve(output,'landing-motion.js'));
copyFileSync(resolve(root,'apps/landing/landing-gallery.css'),resolve(output,'landing-gallery.css'));
copyFileSync(resolve(root,'apps/landing/landing-gallery.js'),resolve(output,'landing-gallery.js'));
copyFileSync(resolve(root,'apps/landing/landing-video.css'),resolve(output,'landing-video.css'));
copyFileSync(resolve(root,'apps/landing/landing-video.js'),resolve(output,'landing-video.js'));
// Bundle all restaurant photos locally: no image CDN, runtime fetch or third-party dependency.
cpSync(resolve(root,'apps/landing/media'),resolve(output,'media'),{recursive:true});
copyFileSync(resolve(root,'apps/landing/landing.js'),resolve(output,'landing.js'));
const adminDir=resolve(output,'admin');mkdirSync(adminDir,{recursive:true});
for(const name of ['html','css','js'])copyFileSync(resolve(root,'apps/landing/admin.'+name),resolve(adminDir,name==='html'?'index.html':'admin.'+name));
const accountDir=resolve(output,'conta');mkdirSync(accountDir,{recursive:true});
copyFileSync(resolve(root,'packages/core/shared/subscription-presentation.mjs'),resolve(accountDir,'subscription-presentation.js'));
for(const name of ['html','css','js'])copyFileSync(resolve(root,'apps/landing/conta.'+name),resolve(accountDir,name==='html'?'index.html':'conta.'+name));
const verificationDir=resolve(output,'verificar-email');mkdirSync(verificationDir,{recursive:true});
copyFileSync(resolve(root,'apps/landing/verificar-email.html'),resolve(verificationDir,'index.html'));
copyFileSync(resolve(root,'apps/landing/verificar-email.js'),resolve(verificationDir,'verificar.js'));
const recoveryDir=resolve(output,'recuperar-senha');mkdirSync(recoveryDir,{recursive:true});
copyFileSync(resolve(root,'apps/landing/recuperar-senha.html'),resolve(recoveryDir,'index.html'));
copyFileSync(resolve(root,'apps/landing/recuperar-senha.js'),resolve(recoveryDir,'recuperar.js'));

copyFileSync(resolve(root,'packages/core/shared/order-composer.js'),resolve(output,'order-composer.js'));
copyFileSync(resolve(root,'packages/core/js/core/mobile-access/qr-code.js'),resolve(output,'local-access-qr.js'));
buildPwaIcons(output);
// Cache only public, reproducible assets, never authenticated API responses.
const publicAssets=[];
const collect=(folder,relative='')=>{
  for(const entry of readdirSync(folder,{withFileTypes:true})){
    const path=relative+'/'+entry.name;
    if(entry.isDirectory())collect(resolve(folder,entry.name),path);
    else if(path!=='/sw.js'&&!path.endsWith('.map')&&!path.endsWith('.mp4'))publicAssets.push(path);
  }
};
collect(output);
publicAssets.sort();
const fingerprint=createHash('sha256');
for(const asset of publicAssets)fingerprint.update(asset).update(readFileSync(resolve(output,asset.slice(1))));
const swfile=resolve(output,'sw.js');
const sw=readFileSync(swfile,'utf8').replace('__SHELL_CACHE__','pdv-total-shell-'+fingerprint.digest('hex').slice(0,14))
  .replace('__ASSET_PRECACHE__',JSON.stringify(publicAssets));
writeFileSync(swfile,sw,'utf8');
const assets=readdirSync(output,{recursive:true});
if(assets.length<40)throw new Error('Missing original UI assets');
if(html.includes('../../packages/core'))throw new Error('Foreign asset path in web HTML');
console.log('PDV Total: built the only original PDV renderer as '+assets.length+' web assets for Workers.');
