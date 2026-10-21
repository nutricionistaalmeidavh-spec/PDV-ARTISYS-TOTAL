import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveLocalPwa} from '../apps/api/src/local-static.mjs';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('marketing is a distinct public entry, not a duplicate operating renderer',()=>{
  const html=source('apps/landing/index.html');
  assert.match(html,/<main id="conteudo">/);
  assert.match(html,/id="registration-form"/);
  assert.match(html,/id="landing-login-form"/);
  assert.match(html,/id="landing-mfa-form"/);
  assert.match(html,/data-open-login/);
  assert.match(html,/data-demo="mesas"/);
  assert.match(html,/data-demo="cardapio"/);
  assert.match(html,/data-demo="cozinha"/);
  assert.doesNotMatch(html,/src="\/app\.js"/);
  assert.match(source('scripts/build-web.mjs'),/app\/index\.html/);
});
test('registration sends only to the same-origin API and has no external dependencies',()=>{
  const js=source('apps/landing/landing.js');
  assert.match(js,/fetch\('\/api\/v1\/auth\/register'/);
  assert.match(js,/credentials:'same-origin'/);
  assert.doesNotMatch(js,/https?:\/\//);
  const wrangler=source('wrangler.jsonc');
  assert.match(wrangler,/"REGISTRATION_ENABLED": "false"/);
});
test('landing login authenticates in place and continues into the operational app',()=>{
  const html=source('apps/landing/index.html');
  const js=source('apps/landing/landing.js');
  assert.match(html,/autocomplete="username"/);
  assert.match(html,/autocomplete="current-password"/);
  assert.match(html,/autocomplete="one-time-code"/);
  assert.match(js,/request\('\/api\/v1\/auth\/login'/);
  assert.match(js,/request\('\/api\/v1\/auth\/mfa\/login'/);
  assert.match(js,/session\.mfaRequired/);
  assert.match(js,/location\.assign\('\/app\/'\)/);
  assert.doesNotMatch(html,/class="nav-login" href="\/app\//);
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


test('premium landing is bundled without remote runtime dependencies or auth route changes',()=>{
  const html=source('apps/landing/index.html');
  const css=source('apps/landing/landing-premium.css');
  const motion=source('apps/landing/landing-motion.js');
  const builder=source('scripts/build-web.mjs');
  assert.match(html,/href="\/landing-premium\.css"/);
  assert.match(html,/src="\/landing-motion\.js"/);
  for(const asset of ['landing-premium.css','landing-motion.js'])
    assert.match(builder,new RegExp("copyFileSync\\(resolve\\(root,'apps/landing/"+asset.replaceAll('.','\\.')+"'" ));
  for(const device of ['premium-laptop','premium-tablet','premium-phone-waiter','premium-phone-kitchen'])
    assert.match(html,new RegExp('class="[^"]*'+device));
  for(const selector of ['data-open-login','data-open-register','registration-form','landing-login-form','landing-mfa-form'])
    assert.match(html,new RegExp(selector));
  assert.match(motion,/IntersectionObserver/);
  assert.match(motion,/prefers-reduced-motion/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(motion,/fetch\(|https?:\/\//);
  assert.doesNotMatch(css,/@import|https?:\/\//);
  assert.match(source('apps/web/manifest.webmanifest'),/\/app\//);
});
