import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync(new URL('../apps/web/web-settings-ui.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html lang="pt-BR"><body data-active-route="settings"><main id="content"></main></body></html>');
  await page.evaluate(()=>{
    window.settingsCalls=[];window.peripheralsOpened=0;window.navigationTargets=[];
    window.PdvCurrentAccess={permissions:['settings.view','settings.manage','modules.manage','users.view']};
    window.PdvAccessPolicy={hasCapability:(user,cap)=>user.permissions.includes(cap)};
    window.PdvWebHardware={showSettings(){window.peripheralsOpened++;}};
    window.PdvModuleGate={reconcile(){}};
    window.PdvToast={show(){}};
    window.settingsApi={webMode:true,tenantId:'qa-company',branchId:'qa-main',async request(path,options){
      window.settingsCalls.push({path,options});
      if(options?.method==='PUT')return {branding:options.body};
      if(path.endsWith('/context'))return {name:'Burguerzão',profileKey:'OWNER'};
      if(path.endsWith('/branches'))return {branches:[{id:'qa-main',name:'Matriz',code:'MAIN'}]};
      if(path.includes('/printing/branding'))return {branding:{name:'Burguerzão',address:'Rua QA',phone:'',logoDataUrl:null}};
      if(path.endsWith('/members'))return {members:[{id:'qa-owner',displayName:'Victor',profileKey:'OWNER'}]};
      if(path==='/api/v1/auth/sessions')return {sessions:[{id:'aaaaaaaaaaaaaaaaaaaaaaaa',current:true,createdAt:1720000000000}]};
      throw Error('Unexpected request '+path);
    },async modules(){return [{id:'FOOD',name:'Alimentação',description:'Mesas, pedidos e cozinha',enabled:true},{id:'WHOLESALE',name:'Atacado',description:'Pedidos por quantidade',enabled:false}];},
    async saveSetting(key,value,scope){window.settingsCalls.push({key,value,scope});}};
  });
  await page.addScriptTag({content:source});
  await page.evaluate(()=>window.PdvWebSettings.render(document.querySelector('#content'),window.settingsApi,{navigate:route=>window.navigationTargets.push(route)}));
  assert.equal(await page.getByRole('heading',{name:'Configurações',exact:true}).count(),1);
  assert.equal(await page.getByRole('tabpanel').filter({visible:true}).count(),1);
  await page.getByLabel('Nome no comprovante').fill('Burguerzão Centro');
  await page.getByRole('button',{name:'Salvar identificação'}).click();
  await page.getByText('Identificação salva para esta filial.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.settingsCalls.find(call=>call.options?.method==='PUT').options.body.branchId),'qa-main');
  assert.equal(await page.evaluate(()=>window.settingsCalls.find(call=>call.options?.method==='PUT').options.body.name),'Burguerzão Centro');
  await page.getByRole('tab',{name:'Áreas',exact:true}).click();
  assert.equal(await page.getByRole('tabpanel').filter({visible:true}).count(),1);
  await page.getByRole('article').filter({has:page.getByRole('heading',{name:'Atacado',exact:true})}).getByRole('checkbox').check();
  await page.getByText('Área atualizada. Os dados e históricos foram preservados.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.settingsCalls.find(call=>call.key)),{key:'modules.WHOLESALE.enabled',value:true,scope:'global'});
  await page.getByRole('tab',{name:'Impressão e periféricos'}).click();
  await page.getByRole('button',{name:'Configurar dispositivos'}).click();
  assert.equal(await page.evaluate(()=>window.peripheralsOpened),1);
  await page.getByRole('tab',{name:'Impressão e periféricos'}).press('Home');
  assert.equal(await page.getByRole('tab',{name:'Empresa e comprovantes'}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'Equipe e filiais'}).click();
  await page.getByRole('button',{name:'Abrir Acessos e equipe'}).click();
  assert.deepEqual(await page.evaluate(()=>window.navigationTargets),['access']);
  await page.evaluate(async()=>{
    document.body.dataset.activeRoute='access';
    await window.PdvWebSettings.renderAccess(document.querySelector('#content'),{api:window.settingsApi,user:{profileKey:'OWNER'},navigate:route=>window.navigationTargets.push(route)});
  });
  assert.equal(await page.getByRole('heading',{name:'Acessos e equipe',exact:true}).count(),1);
  assert.equal(await page.getByText('Victor',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Gerenciar equipe e convites'}).click();
  assert.deepEqual(await page.evaluate(()=>window.navigationTargets),['access','saas-admin']);
  await page.evaluate(async()=>{
    window.PdvCurrentAccess.permissions=[];document.body.dataset.activeRoute='settings';
    await window.PdvWebSettings.render(document.querySelector('#content'),window.settingsApi);
  });
  assert.equal(await page.getByRole('button',{name:'Salvar identificação'}).count(),0);
  // A cashier must be able to save browser device preferences without a
  // server-side branding write, while an owner's branding errors stay visible.
  await page.evaluate(()=>{
    const storage=new Map();
    Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
    window.brandingReads=0;window.brandingWrites=0;
    window.PdvReceiptBranding={read:()=>({name:'Loja QA',address:'Rua QA',phone:'',logoDataUrl:null}),
      load:async()=>{window.brandingReads++;return {name:'Loja QA',address:'Rua QA',phone:'',logoDataUrl:null};},
      save:async()=>{window.brandingWrites++;throw Error('Conexão com servidor indisponível.');}};
  });
  await page.addScriptTag({content:readFileSync(new URL('../apps/web/peripherals-web.js',import.meta.url),'utf8')});
  await page.evaluate(()=>window.PdvWebHardware.showSettings());
  const deviceDialog=page.getByRole('dialog',{name:'Dispositivos e impressão'});
  await deviceDialog.locator('select[name="paperMm"]').selectOption('58');
  await deviceDialog.getByRole('button',{name:'Salvar configurações',exact:true}).click();
  await deviceDialog.getByText('Preferências dos dispositivos salvas neste navegador.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.PdvWebHardware.settings().paperMm),58);
  assert.equal(await page.evaluate(()=>window.brandingReads),0);
  assert.equal(await page.evaluate(()=>window.brandingWrites),0);
  await deviceDialog.getByRole('button',{name:'Fechar',exact:true}).click();
  await page.evaluate(()=>{window.PdvCurrentAccess.permissions=['settings.view','settings.manage'];window.PdvWebHardware.showSettings();});
  await deviceDialog.getByText('Identificação carregada do servidor.',{exact:true}).waitFor();
  await deviceDialog.getByRole('button',{name:'Salvar configurações',exact:true}).click();
  await deviceDialog.getByText('As preferências locais foram salvas. Falha ao sincronizar a identificação: Conexão com servidor indisponível.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.brandingWrites),1);
  assert.deepEqual(errors,[]);
  console.log('PASS hosted settings DOM: tabs and keyboard, receipt save, area toggle, devices, access links and read-only profile');
}finally{await browser.close();}
