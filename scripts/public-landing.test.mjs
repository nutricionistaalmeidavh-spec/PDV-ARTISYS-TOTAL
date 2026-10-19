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
  assert.match(html,/data-demo="mesas"/);
  assert.match(html,/data-demo="cardapio"/);
  assert.match(html,/data-demo="cozinha"/);
  assert.match(html,/\/app\//);
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
    for(const name of ['admin','conta','verificar-email']){
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
