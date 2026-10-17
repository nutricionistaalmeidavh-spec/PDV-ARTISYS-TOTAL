import {mkdirSync,cpSync,copyFileSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,'apps/web'),output=resolve(root,'dist/web');
const allow=new Set(['.html','.css','.js','.svg','.png','.webp','.ico','.webmanifest']);
rmSync(output,{recursive:true,force:true});mkdirSync(output,{recursive:true});
cpSync(source,output,{recursive:true,filter:(path)=>path===source||!extname(path)||allow.has(extname(path))});
const filename=resolve(output,'index.html');
let html=readFileSync(filename,'utf8');
html=html.replace("connect-src 'none'","connect-src 'self'");
html=html.replace('<title>ArtiSys PDV</title>','<title>PDV Total | ArtiSys</title>');
html=html.replace("../../packages/core/shared/order-composer.js","./order-composer.js");
for(const desktopScript of ['first-access-ui.js','updater-ui.js','hardware-scale-ui.js','telemetry-ui.js','reload-transition-ui.js']){
  html=html.replace(new RegExp('\\s*<script defer src="\\./'+desktopScript.replaceAll('.','\\.')+'"></script>','g'),'');
}
html=html.replace('ArtiSys PDV</h1><p>Inicializando sistema local...','PDV Total</h1><p>Conectando ao seu estabelecimento...');
html=html.replace('<div class="window-controls" aria-label="Controles da janela">','<div class="window-controls" hidden aria-label="Controles da janela">');
html=html.replace('<span>Rede Local</span>','<span>Cloudflare</span>').replace('Sistema local</span>','Sistema online</span>');
html=html.replace('</head>','  <link rel="stylesheet" href="./web-cloud.css" />\n</head>');
writeFileSync(filename,html,'utf8');
copyFileSync(resolve(root,'packages/core/shared/order-composer.js'),resolve(output,'order-composer.js'));
const assets=readdirSync(output,{recursive:true});
if(assets.length<40)throw new Error('Missing original UI assets');
if(html.includes('../../packages/core'))throw new Error('Foreign asset path in web HTML');
console.log('PDV Total: built the only original PDV renderer as '+assets.length+' web assets for Workers.');
