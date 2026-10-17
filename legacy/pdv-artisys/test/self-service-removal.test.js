'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const TEXT_EXTENSIONS=new Set(['.js','.mjs','.cjs','.json','.md','.html','.css']);

function activeFiles(){
  const files=[];
  const walk=relative=>{
    const absolute=path.join(root,relative);
    for(const entry of fs.readdirSync(absolute,{withFileTypes:true})){
      const child=path.join(relative,entry.name);
      if(entry.isDirectory())walk(child);
      else if(TEXT_EXTENSIONS.has(path.extname(entry.name)))files.push(child);
    }
  };
  for(const dir of ['js','server','desktop','release','qa','scripts'])walk(dir);
  for(const file of ['README.md','DESIGN.md','UX-CONTRACT.md','package.json'])files.push(file);
  const architecture=path.join(root,'docs','architecture');
  for(const entry of fs.readdirSync(architecture,{withFileTypes:true})){
    if(entry.isFile()&&TEXT_EXTENSIONS.has(path.extname(entry.name)))files.push(path.join('docs','architecture',entry.name));
  }
  return files;
}

test('autoatendimento paired surface is absent from active product authorities',()=>{
  const forbidden=/SELF_SERVICE|self-service|self_service|Autoatendimento|autoatendimento/;
  const violations=[];
  for(const relative of activeFiles()){
    const normalizedRelative=relative.split(path.sep).join('/');
    if(normalizedRelative==='js/core/database/customer-ordering-migrations.js')continue;
    const source=read(relative);
    if(forbidden.test(source))violations.push(relative);
  }
  assert.deepEqual(violations,[],'referências ativas de autoatendimento devem ser removidas');

  const mobileDevices=read('js/domains/restaurant/mobile-device-service.js');
  const releaseMigrations=read('js/core/database/release-migrations.js');
  const runtime=read('js/core/pdv-runtime.js');
  const localServer=read('server/local-server.js');
  const mobileApp=read('server/mobile/app.js');
  const mobileStyles=read('server/mobile/styles.css');
  const verticalUi=read('desktop/renderer/vertical-modules.js');
  const finalUi=read('desktop/renderer/e48-e54-ui.js');

  assert.doesNotMatch(mobileStyles,/\.self-service-/);
  assert.doesNotMatch(runtime,/createSelfService|selfService/);
  assert.doesNotMatch(localServer,/createSelfServiceMobileRouter|selfServiceMobileRouter/);
  assert.doesNotMatch(finalUi,/renderSelfService|data-self-device|self-create/);
  assert.doesNotMatch(verticalUi,/data-food-capability="SELF_SERVICE"|Autoatendimento/);
  assert.doesNotMatch(mobileDevices,/TABLET/);
  assert.doesNotMatch(releaseMigrations,/device_type[^\n]*TABLET/);
});

test('removed autoatendimento implementation files are not part of the runtime tree',()=>{
  assert.equal(fs.existsSync(path.join(root,'js/domains/self-service/self-service.js')),false);
  assert.equal(fs.existsSync(path.join(root,'server/self-service-mobile-router.js')),false);
});

test('public table ordering remains the single customer ordering surface',()=>{
  const publicRouter=read('server/public-ordering-router.js');
  const publicOrdering=read('js/domains/restaurant/public-ordering.js');
  const customerApp=read('server/customer-menu/app.js');
  assert.match(publicRouter,/customer-menu/);
  assert.match(publicRouter,/\^\\\/m\\\//);
  assert.match(publicOrdering,/publicContext|submitOrder/);
  assert.match(customerApp,/api\/v1\/public\/menu/);
});
