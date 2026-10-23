// QA visual auditavel: Chromium real + Workerd/D1 local; apenas dados ficticios.
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright';

const origin = 'http://127.0.0.1:8797';
const output = 'qa-artifacts/visual';
mkdirSync(output,{recursive:true});
const captures=[],problems=[],requestErrors=[];
let browser,worker,workerOutput='';
const owner = {email:'owner@example.test',password:'DummyStrongPassOnlyForCI2026'};
const preferredRoutes = ['home','checkout','FOOD','WHOLESALE','products','customers',
  'suppliers','inventory','sales','cash','finance','finance-banks','finance-recurrences',
  'management','reports','sellers','credit','commissions','saas-admin','settings'];
const clean = s=>String(s).replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,70);
const escapeHtml = s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const maybeVisible=async locator=>(await locator.count())>0 && await locator.first().isVisible().catch(()=>false);

async function record(page,area,label,device,status='ok',note=''){
  const name=String(captures.length+1).padStart(3,'0')+'-'+clean(area)+'-'+clean(label)+'-'+device+'.jpg';
  const path=join(output,name);
  try {
    await page.screenshot({path,type:'jpeg',quality:79,fullPage:area==='publico',animations:'disabled',timeout:9500});
    captures.push({area,label,device,status,note,path});
    console.log('PRINT '+status.toUpperCase()+' '+area+' / '+label+' / '+device);
  } catch(error){
    problems.push('Falha de captura '+area+' / '+label+' / '+device+': '+error.message);
    captures.push({area,label,device,status:'erro',note:error.message,path:null});
  }
}

async function publicScreens(page,device){
  const routes=[
    ['/','Landing pública','landing'],
    ['/recuperar-senha/','Recuperação de senha','recuperar-senha'],
    ['/verificar-email/','Verificação de e-mail','verificar-email'],
    ['/conta/','Área da conta (estado de acesso)','conta'],
    ['/admin/','Painel da plataforma (sem credencial privada)','admin-restrito'],
    ['/app/','Login no PDV','login']
  ];
  for(const [url,label,key] of routes){
    try{
      const response=await page.goto(origin+url,{waitUntil:'domcontentloaded',timeout:16000});
      await page.waitForTimeout(500);
      const status=response?.status()===200?'ok':'erro';
      await record(page,'publico',label,device,status,'HTTP '+(response?.status()||'sem resposta')+'; captura da página renderizada');
      if(status!=='ok')problems.push(url+' respondeu HTTP '+(response?.status()||'indefinido'));
      if(url==='/'){
        const register=page.locator('[data-open-register]').first();
        if(await maybeVisible(register)){
          await register.click();
          await page.locator('#registration-dialog[open]').waitFor({timeout:5000});
          await record(page,'publico','Cadastro de estabelecimento',device);
          await page.locator('[data-close-register]').click();
        }else{
          problems.push('Botão de cadastro não encontrado na landing '+device);
        }
      }
    }catch(error){problems.push('Página '+url+' '+device+': '+error.message);}
  }
}

async function login(page,device){
  await page.goto(origin+'/app/',{waitUntil:'domcontentloaded',timeout:20000});
  await page.locator('#web-login-form').waitFor({state:'visible',timeout:15000});
  await page.locator('#web-email').fill(owner.email);
  await page.locator('#web-password').fill(owner.password);
  await page.locator('#web-login-form button[type=submit]').click();
  await page.locator('body[data-active-route="checkout"]').waitFor({timeout:20000});
  if(await maybeVisible(page.locator('#r4-segment-first-run'))){
    await record(page,'aplicativo','Escolha inicial do segmento',device);
    await page.locator('#r4-segment-first-run [name=segmentId]').selectOption('RESTAURANT');
    await page.locator('#r4-segment-first-run [type=submit]').click();
    await page.locator('#r4-segment-first-run').waitFor({state:'detached',timeout:12000});
  }
  if(await maybeVisible(page.locator('#auth-overlay #web-login-form'))){
    throw new Error('Overlay de login permanece aberto depois de autenticar');
  }
  await page.locator('#sidebar-nav [data-route]').first().waitFor({timeout:12000});
}

async function applicationScreens(page,device){
  await login(page,device);
  const routes=await page.locator('#sidebar-nav [data-route]').evaluateAll(nodes=>
    [...new Set(nodes.filter(el=>!el.hidden && getComputedStyle(el).display!=='none').map(el=>el.dataset.route))]);
  if(await maybeVisible(page.locator('#app-sidebar [data-route="settings"]')))routes.push('settings');
  const available=[...new Set(routes)];
  const missing=preferredRoutes.filter(route=>!available.includes(route));
  await record(page,'aplicativo','Visão autenticada inicial',device);
  for(const route of available){
    if(!preferredRoutes.includes(route))continue;
    try {
      const button=page.locator('#app-sidebar [data-route="'+route+'"]').first();
      await button.waitFor({state:'visible',timeout:4500});
      await button.click();
      await page.locator('body[data-active-route="'+route+'"]').waitFor({timeout:7500});
      await page.waitForTimeout(300);
      const text=(await page.locator('#route-content').innerText().catch(()=>'' )).trim();
      const good=text.length>=12 && !(await maybeVisible(page.locator('#auth-overlay #web-login-form')));
      if(!good)problems.push('Rota '+route+' sem conteúdo visível ou bloqueada: '+device);
      await record(page,'rota',route,device,good?'ok':'erro',
        'Rota do sistema autenticamente navegada; caracteres visíveis='+text.length);
      const tabs=page.locator('#route-content [role="tab"]:visible');
      const count=Math.min(await tabs.count(),6);
      for(let i=0;i<count;i++){
        const tab=page.locator('#route-content [role="tab"]:visible').nth(i);
        const name=(await tab.innerText().catch(()=>'' )).trim()||'aba-'+(i+1);
        try {
          if(await tab.isEnabled()){
            await tab.click({timeout:2500});
            await page.waitForTimeout(300);
            await record(page,'aba-'+route,name,device);
          }
        }catch(error){problems.push('Aba '+route+'/'+name+': '+error.message);}
      }
    }catch(error){
      problems.push('Falha na rota '+route+' / '+device+': '+error.message);
      await record(page,'rota',route,device,'erro','Navegação indisponível: '+error.message);
    }
  }
  return {available,missing};
}

async function reportPdf(){
  const cover = '<section class="sheet cover"><div class="eyebrow">ARTISYS / PDV TOTAL</div>'+
    '<h1>Relatório de QA visual</h1><p class="lead">Capturas reais do Chromium contra Workerd + D1 locais, com conta fictícia isolada. Sem mockups de interface operacional.</p>'+
    '<div class="meta"><div><span>Execução</span><b>'+escapeHtml(new Date().toISOString())+'</b></div>'+
    '<div><span>Commit</span><b>'+escapeHtml(process.env.GITHUB_SHA||'execução local')+'</b></div>'+
    '<div><span>Imagens</span><b>'+captures.filter(x=>x.path).length+'</b></div>'+
    '<div><span>Ocorrências</span><b>'+problems.length+'</b></div></div>'+
    '<h2>Critérios</h2><p>Cada tela foi aberta em navegador real e fotografada após a navegação. Screenshots públicos podem mostrar telas de login ou barreiras de segurança. Áreas indisponíveis por permissão ou por módulo desligado não são declaradas homologadas.</p>'+
    '<h2>Cobertura de navegação</h2><p>'+escapeHtml(JSON.stringify(coverage))+'</p></section>';
  const slides=captures.filter(x=>x.path).map((c,i)=>{
    const data=readFileSync(c.path).toString('base64');
    return '<section class="sheet"><div class="top"><div><span class="number">'+
      String(i+1).padStart(2,'0')+' / '+String(captures.filter(x=>x.path).length).padStart(2,'0')+
      '</span><h2>'+escapeHtml(c.label)+'</h2><p>'+escapeHtml(c.area)+' · '+escapeHtml(c.device)+
      ' · '+escapeHtml(c.status)+'</p></div><div class="brand">ARTISYS<br><small>PDV TOTAL</small></div></div>'+
      '<div class="shot"><img src="data:image/jpeg;base64,'+data+'" alt="'+escapeHtml(c.label)+'"></div>'+
      '<div class="foot">'+escapeHtml(c.note||'Screenshot real do navegador de QA')+'</div></section>';
  }).join('');
  const notes='<section class="sheet appendix"><h1>Ocorrências e limitações</h1>'+
    (problems.length?'<ol>'+problems.slice(0,100).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol>':
    '<p>Não houve ocorrência registrada no inventário visual.</p>')+
    '<p>Este PDF documenta a interface na instância isolada de QA; não certifica produção, equipamentos físicos, adquirência, integrações externas nem telas restritas que exigem credenciais administrativas reais.</p></section>';
  const style='<style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;background:#f0f3f8;color:#101d37;font-family:Arial,sans-serif}.sheet{height:210mm;width:297mm;page-break-after:always;overflow:hidden;background:#fff;padding:14mm 16mm;position:relative}.sheet:last-child{page-break-after:auto}.cover{background:#091e40;color:#fff;padding:27mm 28mm}.eyebrow{font-size:12px;letter-spacing:3px;color:#86c9ff}.cover h1{font-size:37px;margin:15mm 0 4mm}.lead{font-size:18px;max-width:225mm;line-height:1.45;color:#dce9fa}.cover h2{font-size:16px;margin:13mm 0 3mm}.cover p{font-size:13px;line-height:1.45}.meta{display:flex;gap:6mm;margin:12mm 0}.meta div{background:#15355f;border-radius:9px;padding:6mm 7mm;min-width:49mm}.meta span{display:block;color:#aad5ff;font-size:11px;margin-bottom:6px}.meta b{font-size:13px}.top{height:23mm;display:flex;justify-content:space-between;align-items:start}.top h2{font-size:22px;margin:2mm 0 0}.top p{color:#657388;margin:2mm 0;font-size:12px}.number{font-size:11px;letter-spacing:1px;color:#266fc0}.brand{text-align:right;color:#0c3970;font-weight:900;font-size:18px;line-height:1}.brand small{font-size:10px;letter-spacing:2px}.shot{width:265mm;height:154mm;border:1px solid #dbe3ef;border-radius:5px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f8fafc}.shot img{width:100%;height:100%;object-fit:contain}.foot{padding:4mm 1mm;color:#64748b;font-size:10px}.appendix h1{font-size:29px}.appendix ol{columns:2;column-gap:12mm;font-size:11px;line-height:1.6}.appendix li{break-inside:avoid;margin-bottom:3mm}.appendix p{font-size:13px}</style>';
  const printPage=await browser.newPage({viewport:{width:1200,height:900}});
  try{
    await printPage.setContent('<!doctype html><html><head><meta charset="utf-8">'+style+'</head><body>'+cover+slides+notes+'</body></html>',{waitUntil:'load',timeout:90000});
    await printPage.pdf({path:'qa-artifacts/pdv-total-qa-visual.pdf',printBackground:true,preferCSSPageSize:true,timeout:120000});
  }finally{await printPage.close();}
}
const coverage={};
try {
  worker=spawn('npx',['--yes','wrangler@4.137.0','dev','--local','--ip','127.0.0.1','--port','8797',
    '--var','AUTH_ENABLED:true','--var','COOKIE_SECURE:false',
    '--var','REGISTRATION_ENABLED:false','--var','EMAIL_FROM:disabled-in-local-e2e'],{
      stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',env:{...process.env,CI:'true'}
    });
  for(const stream of [worker.stdout,worker.stderr])stream.on('data',chunk=>{
    workerOutput=(workerOutput+chunk.toString()).slice(-12000);
  });
  let ready=false;
  for(let i=0;i<100;i++){
    if(worker.exitCode!==null)break;
    try{const res=await fetch(origin+'/api/v1/health',{signal:AbortSignal.timeout(1200)});
      if(res.ok){ready=true;break;}
    }catch{}
    await sleep(400);
  }
  if(!ready)throw new Error('Workerd não inicializou: '+workerOutput);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const [device,viewport] of [
    ['desktop',{width:1440,height:900}],
    ['mobile',{width:390,height:844}]
  ]){
    const context=await browser.newContext({viewport,deviceScaleFactor:1,locale:'pt-BR'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',res=>{if(res.status()>=500)requestErrors.push(res.status()+' '+new URL(res.url()).pathname);});
    try{
      await publicScreens(page,device);
      coverage[device]=await applicationScreens(page,device);
    }catch(error){problems.push('Fluxo '+device+': '+error.message);}
    if(errors.length)problems.push(...errors.map(x=>'Javascript '+device+': '+x));
    await context.close();
  }
  if(requestErrors.length)problems.push(...requestErrors.map(x=>'HTTP 5xx: '+x));
  writeFileSync('qa-artifacts/pdv-total-inventario-visual.json',JSON.stringify({
    generatedAt:new Date().toISOString(),origin:'Workerd/D1 local, dados fictícios',
    commit:process.env.GITHUB_SHA||null,captures,coverage,problems
  },null,2));
  await reportPdf();
  console.log('QA_VISUAL_RESUMO '+JSON.stringify({prints:captures.filter(x=>x.path).length,coverage,errors:problems.length}));
  if(!captures.some(x=>x.area==='rota'&&x.status==='ok'))throw new Error('Nenhuma rota operacional comprovada visualmente');
  if(problems.length)process.exitCode=1;
}catch(error){
  problems.push(error.message);
  writeFileSync('qa-artifacts/pdv-total-erros-visual.json',JSON.stringify(problems,null,2));
  console.error(error);
  process.exitCode=1;
}finally{
  if(browser)await browser.close();
  if(worker?.pid){
    try{if(process.platform==='win32')worker.kill('SIGTERM');else process.kill(-worker.pid,'SIGTERM');}catch{}
  }
}
