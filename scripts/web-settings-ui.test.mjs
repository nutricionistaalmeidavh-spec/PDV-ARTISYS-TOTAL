import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../apps/web/web-settings-ui.js',import.meta.url),'utf8');
function element(extra={}){
  return {listeners:{},disabled:false,addEventListener(name,fn){this.listeners[name]=fn;},...extra};
}
function setup({permissions=['settings.view','settings.manage','modules.manage','users.view'],selectors={},lists={},route='settings',request}={}){
  const calls=[];
  const host={innerHTML:'',isConnected:true,querySelector:selector=>selectors[selector]||null,querySelectorAll:selector=>lists[selector]||[]};
  const window={document:{body:{dataset:{activeRoute:route}}},PdvCurrentAccess:{permissions},
    PdvAccessPolicy:{hasCapability:(user,cap)=>user.permissions.includes(cap)},
    PdvToast:{show(){}},PdvRouteRegistry:{updated(){}},
    location:{assign(path){calls.push({redirect:path});}},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent(){},
    PdvModuleGate:{reconcile(){}}
  };
  const api={webMode:true,tenantId:'shop-a',branchId:'branch-a',
    async request(path,options){
      calls.push({path,options});if(request)return request(path,options);
      if(path.endsWith('/context'))return {name:'Empresa <A>',profileKey:'OWNER'};
      if(path.endsWith('/branches'))return {branches:[{id:'branch-a',name:'Matriz',code:'MAIN'}]};
      if(path.startsWith('/api/v1/printing/branding'))return {branding:{name:'Loja A',address:'Rua A',phone:'123',logoDataUrl:null}};
      if(path.endsWith('/members'))return {members:[]};
      if(path==='/api/v1/auth/sessions')return {sessions:[]};
      return {};
    },
    async modules(){calls.push({modules:true});return [{id:'FOOD',name:'Alimentação',description:'Mesas e cozinha',enabled:true}];},
    async saveSetting(key,value,scope){calls.push({key,value,scope});}
  };
  runInNewContext(source,{window});
  return {window,api,host,calls};
}

test('hosted settings show business, receipts, equipment and areas without loading LAN administration',async()=>{
  const {window,api,host,calls}=setup();
  await window.PdvWebSettings.render(host,api);
  assert.match(host.innerHTML,/Empresa &lt;A&gt;/);
  assert.match(host.innerHTML,/Matriz/);
  assert.match(host.innerHTML,/Identificação nos comprovantes/);
  assert.match(host.innerHTML,/Impressão e periféricos/);
  assert.match(host.innerHTML,/Funcionamento offline/);
  assert.match(host.innerHTML,/vendas, caixa e estoque ainda não disponível/i);
  assert.match(host.innerHTML,/data-settings-offline-gateway/);
  assert.doesNotMatch(host.innerHTML,/data-settings-offline-enable/);

  assert.match(host.innerHTML,/Alimentação/);
  assert.ok(calls.some(call=>call.path==='/api/v1/tenants/shop-a/context'));
  assert.ok(calls.some(call=>call.path==='/api/v1/printing/branding?branchId=branch-a'));
  assert.ok(calls.every(call=>!call.path?.includes('/lan/')));
});

test('nonowner hosted settings never expose offline gateway secrets or enrollment form',async()=>{
 const {window,api,host}=setup({permissions:[]});
 api.request=async path=>path.endsWith('/context')?{name:'Loja',profileKey:'WAITER'}:
  path.endsWith('/branches')?{branches:[{id:'branch-a',name:'Matriz',code:'MAIN'}]}:{};
 await window.PdvWebSettings.render(host,api);
 assert.match(host.innerHTML,/Funcionamento offline/);
 assert.doesNotMatch(host.innerHTML,/data-settings-offline-gateway/);
});
test('receipt settings save to the selected branch and retain its current logo',async()=>{
  const feedback=element(),submit=element();
  const fields={name:{value:'Burguerzão'},address:{value:'Rua nova'},phone:{value:'(11) 1234'},removeLogo:{checked:false},logo:{files:[]}};
  const form=element({elements:{namedItem:name=>fields[name]},querySelector:selector=>selector==='[type="submit"]'?submit:feedback});
  const {window,api,host,calls}=setup({selectors:{'[data-settings-branding]':form}});
  await window.PdvWebSettings.render(host,api);
  await form.listeners.submit({preventDefault(){},currentTarget:form});
  const saved=calls.find(call=>call.options?.method==='PUT');
  assert.equal(saved.path,'/api/v1/printing/branding');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.options.body)),{branchId:'branch-a',name:'Burguerzão',address:'Rua nova',phone:'(11) 1234',logoDataUrl:null});
  assert.equal(submit.disabled,false);
  assert.match(feedback.textContent,/salva/);
});

test('failed area change restores the switch instead of pretending the area was enabled',async()=>{
  const input=element({dataset:{settingsModule:'WHOLESALE'},checked:false}),feedback=element();
  const {window,api,host}=setup({selectors:{'[data-module-feedback]':feedback},lists:{'[data-settings-module]':[input]}});
  api.saveSetting=async()=>{throw Error('Permissão insuficiente.');};
  await window.PdvWebSettings.render(host,api);
  input.checked=true;
  await input.listeners.change();
  assert.equal(input.checked,false);
  assert.equal(input.disabled,false);
  assert.equal(feedback.textContent,'Permissão insuficiente.');
});

test('staff without configuration rights can reach device and account preferences without requesting protected branding',async()=>{
  const {window,api,host,calls}=setup({permissions:[]});
  await window.PdvWebSettings.render(host,api);
  assert.match(host.innerHTML,/Configurar dispositivos/);
  assert.match(host.innerHTML,/Sua conta e segurança/);
  assert.ok(!calls.some(call=>call.path?.includes('printing/branding')||call.modules));
  assert.doesNotMatch(host.innerHTML,/data-settings-branding/);
});

test('navigation during load cannot overwrite the next page with old settings',async()=>{
  const {window,api,host}=setup();
  const loading=window.PdvWebSettings.render(host,api);
  window.document.body.dataset.activeRoute='checkout';host.innerHTML='Venda atual';
  await loading;
  assert.equal(host.innerHTML,'Venda atual');
});

test('a slower settings response cannot overwrite the latest render on the same route',async()=>{
  let firstContext,contextCalls=0;
  const {window,api,host}=setup({request:async path=>{
    if(path.endsWith('/context')){
      if(++contextCalls===1)return new Promise(resolve=>{firstContext=resolve;});
      return {name:'Empresa mais recente',profileKey:'OWNER'};
    }
    if(path.endsWith('/branches'))return {branches:[]};
    if(path.includes('printing/branding'))return {branding:{name:'Comprovante',address:'',phone:'',logoDataUrl:null}};
    return {};
  }});
  const slow=window.PdvWebSettings.render(host,api);
  await window.PdvWebSettings.render(host,api);
  assert.match(host.innerHTML,/Empresa mais recente/);
  firstContext({name:'Resposta antiga',profileKey:'OWNER'});await slow;
  assert.match(host.innerHTML,/Empresa mais recente/);assert.doesNotMatch(host.innerHTML,/Resposta antiga/);
});

test('access view exposes only own sessions to staff without team rights and revokes through authenticated session API',async()=>{
  const revoke=element({dataset:{accessRevoke:'0123456789abcdef01234567',current:'false'}}),feedback=element();
  const {window,api,host,calls}=setup({route:'access',permissions:[],selectors:{'[data-access-feedback]':feedback},lists:{'[data-access-revoke]':[revoke]},
    request:async(path,options)=>{
      if(options?.method==='DELETE')return {revoked:true};
      if(path==='/api/v1/auth/sessions')return {sessions:[{id:'0123456789abcdef01234567',current:false,createdAt:1720000000000}]};
      throw Error('Unexpected '+path);
    }});
  await window.PdvWebSettings.renderAccess(host,{api,user:{profileKey:'CASHIER'}});
  assert.match(host.innerHTML,/Suas sessões/);
  assert.doesNotMatch(host.innerHTML,/Gerenciar equipe e convites/);
  assert.ok(!calls.some(call=>call.path?.endsWith('/members')));
  await revoke.listeners.click();
  assert.ok(calls.some(call=>call.path==='/api/v1/auth/sessions/0123456789abcdef01234567'&&call.options?.method==='DELETE'));
});
