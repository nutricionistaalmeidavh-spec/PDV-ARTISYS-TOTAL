import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveLocalPwa} from '../apps/api/src/local-static.mjs';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('marketing is a distinct public entry and shows only the installed product',()=>{
  const html=source('apps/landing/index.html');
  assert.match(html,/<main id="conteudo">/);
  assert.match(html,/PDV ArtiSys/);
  assert.match(html,/R\\$ 89,90/);
  assert.match(html,/sem mensalidade/i);
  assert.match(html,/data-demo="mesas"/);
  assert.match(html,/data-demo="cardapio"/);
  assert.match(html,/data-demo="cozinha"/);
  assert.doesNotMatch(html,/src="\\/app\\.js"/);
  assert.match(source('scripts/build-web.mjs'),/app\\/index\\.html/);
});

test('public landing sells installed software directly, not online subscriptions or trials',()=>{
  const html=source('apps/landing/index.html');
  assert.match(html,/instalar no computador/i);
  assert.match(html,/pagamento único/i);
  assert.match(html,/https:\\/\\/www\\.instagram\\.com\\/artisysdev\\//);
  for(const forbidden of [/14 dias/i,/teste grátis/i,/mensalidade[s]? recorrente/i,/data-open-register/,/data-open-login/,/registration-dialog/,/login-dialog/,/registration-form/,/landing-login-form/,/landing-mfa-form/,/href="\\/conta\\//])
    assert.doesNotMatch(html,forbidden);
});

test('public landing does not submit credentials or expose registration and login',()=>{
  const html=source('apps/landing/index.html');
  const js=source('apps/landing/landing.js');
  assert.doesNotMatch(html,/<form\\b/);
  assert.doesNotMatch(js,/fetch\\(|\\/api\\/v1\\/auth\\/|location\\.assign\\('/);
  assert.match(js,/data-demo/);
  assert.match(js,/aria-selected/);
});

test('PWA opens the operational system, never marketing, when installed',()=>{
  const manifest=JSON.parse(source('apps/web/manifest.webmanifest'));
  assert.equal(manifest.start_url,'/app/');
  assert.equal(manifest.id,'/app/');
  assert.match(source('apps/web/sw.js'),/\/app\/index.html/);
});
test('self-hosted static server resolves only exact landing and app entrypoints',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pdv-public-'));
  try{
    mkdirSync(join(dir,'app'));
    for(const name of ['admin','conta','verificar-email','recuperar-senha']){
      mkdirSync(join(dir,name));
      writeFileSync(join(dir,name,'index.html'),'Área '+name);
    }
    writeFileSync(join(dir,'index.html'),'Landing PDV Total');
    writeFileSync(join(dir,'app','index.html'),'PDV autenticado');
    assert.equal(await (await serveLocalPwa('/',{rootDir:dir})).text(),'Landing PDV Total');
    for(const p of ['/app','/app/'])assert.equal(await (await serveLocalPwa(p,{rootDir:dir})).text(),'PDV autenticado');
    for(const p of ['admin','conta','verificar-email']){
      assert.equal(await (await serveLocalPwa('/'+p+'/',{rootDir:dir})).text(),'Área '+p);
      assert.equal(await (await serveLocalPwa('/'+p,{rootDir:dir})).text(),'Área '+p);
    }
    assert.equal((await serveLocalPwa('/area-nao-registrada/',{rootDir:dir})).status,400);
    assert.notEqual((await serveLocalPwa('/../index.html',{rootDir:dir})).status,200);
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test('premium marketing assets and motion are bundled without remote runtime dependencies',()=>{
  const html=source('apps/landing/index.html');
  const css=source('apps/landing/landing-premium.css');
  const motion=source('apps/landing/landing-motion.js');
  const builder=source('scripts/build-web.mjs');
  assert.match(html,/href="\\/landing-premium\\.css"/);
  assert.match(html,/src="\\/landing-motion\\.js"/);
  for(const asset of ['landing-premium.css','landing-motion.js'])
    assert.match(builder,new RegExp("copyFileSync\\\\(resolve\\\\(root,'apps/landing/"+asset.replaceAll('.','\\\\.')+"'" ));
  assert.match(html,/class="photo-hero"/);
  assert.match(html,/class="demo-panel demo-photo-panel"/);
  assert.doesNotMatch(html,/class="premium-laptop"/);
  assert.match(builder,/cpSync\\(resolve\\(root,'apps\\/landing\\/media'/);
  assert.doesNotMatch(html,/landing-auth\\.css|data-open-login|data-open-register/);
  assert.match(motion,/IntersectionObserver/);
  assert.match(motion,/prefers-reduced-motion/);
  assert.match(css,/@media\\(prefers-reduced-motion:reduce\\)/);
  assert.doesNotMatch(motion,/fetch\\(|https?:\\/\\//);
  assert.doesNotMatch(css,/@import|https?:\\/\\//);
  assert.match(source('apps/web/manifest.webmanifest'),/\\/app\\//);
});

test('preview gallery remains first-party, swipeable and scoped outside auth',()=>{
  const html=source('apps/landing/index.html');
  const script=source('apps/landing/landing-gallery.js');
  const css=source('apps/landing/landing-gallery.css');
  const build=source('scripts/build-web.mjs');
  for(const path of ['landing-gallery.css','landing-gallery.js']){
    assert.match(html,new RegExp(path.replaceAll('.','\\.')));
    assert.match(build,new RegExp(path.replaceAll('.','\\.')));
  }
  for(const attr of ['data-gallery-prev','data-gallery-next','data-gallery-expand','data-gallery-counter','data-gallery-zoom-content','data-gallery-zoom-close']){
    assert.match(html,new RegExp(attr));
  }
  assert.match(html,/id="painel-caixa"/);
  assert.match(html,/data-demo="caixa"/);
  assert.match(script,/pointerdown/);
  assert.match(script,/pointerup/);
  assert.match(script,/showModal/);
  assert.match(css,/touch-action:pan-y/);
  assert.doesNotMatch(script,/\/api\/|fetch\(|https?:\/\//);
});

test('marketing photos are real local WebP files and four gallery images can enlarge',()=>{
  const html=source('apps/landing/index.html');
  const expected=['pdv-integrado','pdv-mesas','pdv-cardapio','pdv-garcom-cozinha','pdv-caixa'];
  for(const name of expected){
    const path='apps/landing/media/'+name+'.webp';
    const image=readFileSync(new URL('../'+path,import.meta.url));
    assert.equal(image.toString('ascii',0,4),'RIFF',path+' RIFF header');
    assert.equal(image.toString('ascii',8,12),'WEBP',path+' WebP header');
    assert.ok(image.length>20000&&image.length<400000,'optimized non-placeholder local image '+path);
    assert.match(html,new RegExp('/media/'+name+'\\.webp'));
  }
  assert.equal((html.match(/class="demo-photo-figure"/g)||[]).length,4);
  assert.equal((html.match(/class="demo-panel demo-photo-panel"/g)||[]).length,4);
  assert.match(source('scripts/build-web.mjs'),/cpSync\(resolve\(root,'apps\/landing\/media'/);
});


test('hero prioritizes integrated mockup and preserves expanded gallery',()=>{
  const html=source('apps/landing/index.html');
  const css=source('apps/landing/landing-gallery.css');
  assert.match(html,/<section class="hero premium-hero container"/);
  assert.match(html,/<h1 id="hero-title">Tudo conectado/);
  assert.match(html,/class="hero-visual premium-stage"/);
  assert.match(html,/src="\\/media\\/pdv-integrado\\.webp"/);
  assert.match(html,/<section class="trust-strip"[\\s\\S]*?<strong>Cardápio<\\/strong>[\\s\\S]*?<strong>Mesas<\\/strong>/);
  assert.match(css,/\\.premium-hero::before\\{/);
  assert.match(css,/\\.premium-hero \\.premium-stage \\.photo-hero img\\{/);
  assert.match(css,/@media\\(max-width:760px\\)/);
  assert.match(html,/id="demo-gallery-zoom"/);
  assert.doesNotMatch(html,/id="registration-form"|id="landing-login-form"|id="landing-mfa-form"/);
});

test('PDV hostname retains existing Worker and API but public marketing has no login link',()=>{
 const config=JSON.parse(source('wrangler.jsonc').replace(/^\\s*\\/\\/.*$/gm,''));
 assert.equal(config.name,'pdv-artisys-total');
 assert.equal(config.main,'apps/api/src/worker.mjs');
 assert.equal(config.workers_dev,true,'legacy integrations must stay reachable');
 assert.deepEqual(config.routes,[{pattern:'pdv.artisys.dev',custom_domain:true}]);
 assert.equal(config.assets.binding,'ASSETS');
 assert.ok(config.assets.run_worker_first.includes('/api/*'),'existing API routing must remain unchanged');
 const api=source('apps/api/src/worker.mjs');
 assert.ok(api.includes("path==='/api/v1/integrations/artisys/platform'"));
 assert.ok(api.includes("path==='/api/v1/integrations/artisys/billing'"));
 assert.doesNotMatch(source('apps/landing/landing.js'),/\\/api\\//);
});

test('local workerd smoke uses a temporary config without production routes',()=>{
 const smoke=source('scripts/smoke-workerd.mjs');
 assert.ok(smoke.includes("delete devConfig.routes"));
 assert.ok(smoke.includes("'--config',devConfigPath"));
 assert.ok(smoke.includes('unlinkSync(devConfigPath)'));
 assert.ok(!smoke.includes('--infer-origin-from-routes=false'));
 const browserSmoke=source('scripts/web-browser-e2e.mjs');
 assert.ok(browserSmoke.includes('delete devConfig.routes'));
 assert.ok(browserSmoke.includes("'--config',devConfigPath"));
 assert.ok(browserSmoke.includes('unlinkSync(devConfigPath)'));
});


test('product videos are first-party lazy, accessible and unaffected by sales copy',()=>{
  const html=source('apps/landing/index.html');
  const css=source('apps/landing/landing-video.css');
  const js=source('apps/landing/landing-video.js');
  const build=source('scripts/build-web.mjs');
  assert.match(html,/id="videos-em-acao"/);
  for(const name of ['mesas','estoque']){
    assert.match(html,new RegExp('/media/pdv-demo-'+name+'\\\\.mp4'));
    assert.match(html,new RegExp('data-video="'+name+'"'));
  }
  assert.match(html,/<video[^>]*muted[^>]*playsinline[^>]*controls[^>]*preload="none"/);
  assert.match(html,/href="\\/landing-video\\.css"/);
  assert.match(html,/src="\\/landing-video\\.js"/);
  assert.match(build,/landing-video\\.css/);
  assert.match(build,/landing-video\\.js/);
  assert.match(build,/!path\\.endsWith\\('\\.mp4'\\)/);
  assert.match(source('apps/api/src/local-static.mjs'),/'\\.mp4':'video\\/mp4'/);
  assert.match(js,/IntersectionObserver/);
  assert.match(js,/prefers-reduced-motion/);
  assert.match(css,/@media\\s*\\(max-width:\\s*760px\\)/);
  assert.doesNotMatch(js,/fetch\\(|https?:\\/\\//);
  assert.doesNotMatch(html,/src="https?:\\/\\//);
  assert.match(html,/src="\\/media\\/pdv-integrado\\.webp"/);
  assert.doesNotMatch(html,/id="registration-dialog"|id="login-dialog"/);
});

test('product showcase files are actual locally optimized MP4s',()=>{
  const html=source('apps/landing/index.html');
  for(const name of ['mesas','estoque']){
    const path='apps/landing/media/pdv-demo-'+name+'.mp4';
    const video=readFileSync(new URL('../'+path,import.meta.url));
    assert.equal(video.toString('ascii',4,8),'ftyp',path+' MP4 file signature');
    assert.ok(video.length>10000&&video.length<500000,path+' must be optimized for lightweight delivery');
    assert.match(html,new RegExp('/media/pdv-demo-'+name+'\\.mp4'));
  }
});

test('self-hosted landing serves MP4 with a video content type',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pdv-video-'));
  try{
    mkdirSync(join(dir,'media'));
    writeFileSync(join(dir,'media/pdv-demo-mesas.mp4'),Buffer.from('0000ftyp','ascii'));
    const response=await serveLocalPwa('/media/pdv-demo-mesas.mp4',{rootDir:dir});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'video/mp4');
    assert.equal((await response.arrayBuffer()).byteLength,8);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('both video demonstrations autoplay in continuous loop',()=>{
  const html=source('apps/landing/index.html');
  const players=Array.from(html.matchAll(/<video\s+[^>]*data-video="(mesas|estoque)"[^>]*>/g));
  assert.equal(players.length,2);
  for(const [,name] of players){
    const tag=players.find(match=>match[1]===name)[0];
    assert.match(tag,/\sloop(?:\s|>)/,'missing continuous loop for '+name);
    assert.match(tag,/\smuted\s/);
    assert.match(tag,/\splaysinline\s/);
  }
});

test('video posters match their respective portrait clips',()=>{
  const html=source('apps/landing/index.html');
  for(const name of ['mesas','estoque']){
    const filename='apps/landing/media/pdv-demo-'+name+'-poster.webp';
    const poster=readFileSync(new URL('../'+filename,import.meta.url));
    assert.equal(poster.toString('ascii',0,4),'RIFF');
    assert.equal(poster.toString('ascii',8,12),'WEBP');
    assert.ok(poster.length>5000&&poster.length<50000);
    assert.match(html,new RegExp('poster="/media/pdv-demo-'+name+'-poster\\.webp"'));
  }
});
