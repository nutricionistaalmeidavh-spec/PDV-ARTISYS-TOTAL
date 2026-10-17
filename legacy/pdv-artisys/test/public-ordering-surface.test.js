'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('new restaurant ordering scripts parse and stay local-first',()=>{const scripts=['js/domains/restaurant/public-ordering.js','server/public-ordering-router.js','server/mobile-assets-router.js','server/customer-menu/app.js','server/mobile/pwa.js','server/mobile/sw.js','desktop/renderer/restaurant-public-ordering-ui.js'];for(const file of scripts)assert.doesNotThrow(()=>new vm.Script(read(file),{filename:file}),file);const html=read('server/customer-menu/index.html');assert.doesNotMatch(html,/https?:\/\//i);assert.match(html,/\/menu\/app\.js/);assert.match(html,/\/menu\/styles\.css/);const mobile=read('server/mobile/index.html');assert.match(mobile,/manifest\.webmanifest/);assert.match(mobile,/\/mobile\/pwa\.js/);});

test('desktop restaurant loads QR/menu extension without replacing canonical restaurant UI',()=>{const html=read('desktop/renderer/index.html');assert.match(html,/restaurant-ui\.js/);assert.match(html,/restaurant-public-ordering-ui\.js/);assert.match(html,/restaurant-public-ordering-ui\.css/);const ui=read('desktop/renderer/restaurant-public-ordering-ui.js');assert.match(ui,/public-ordering\/menu/);assert.match(ui,/tables\/\$\{encodeURIComponent\(table\.id\)\}\/qr/);assert.doesNotMatch(ui,/confirm\s*\(/);});

test('public table router is composed first and protected management stays in restaurant routes',()=>{const local=read('server/local-server.js');assert.match(local,/let handled=await publicOrderingHandler\(req,res\)/);assert.equal(fs.existsSync(path.join(root,'server/self-service-mobile-router.js')),false);const protectedSource=read('server/restaurant-router.js');assert.match(protectedSource,/restaurant\/public-ordering\/config/);assert.match(protectedSource,/publicTableQr/);});
