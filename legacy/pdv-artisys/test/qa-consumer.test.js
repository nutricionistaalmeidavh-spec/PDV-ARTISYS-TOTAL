const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'qa', 'artisys-qa.config.json');

test('PDV declares a reusable ArtiSys QA consumer manifest', () => { const config=JSON.parse(fs.readFileSync(configPath,'utf8')); assert.equal(config.schemaVersion,1); assert.equal(config.systemId,'pdv-artisys'); assert.equal(config.mode,'electron'); assert.equal(config.defaultEnvironment,'ci'); assert.equal(config.defaultFlow,'all-pages-audit'); assert.equal(config.defaultDemo,'quick-30s'); assert.equal(config.capture.video,true); assert.ok(config.electron.entry.endsWith('desktop/main.cjs')); assert.ok(config.electron.executablePath.includes('node_modules/electron')); assert.deepEqual(config.flows,{'all-pages-audit':'flows/all-pages-audit.json','access-center-partial-permissions':'flows/access-center-partial-permissions.json','access-center-ergonomic':'flows/access-center-ergonomic.json','delivery-pickup-operational':'flows/delivery-pickup-operational-e2e.json','public-menu-compact-v2':'flows/public-menu-compact-v2.json','semantic-regression':'flows/semantic-regression-e2e.json'}); assert.equal(fs.existsSync(path.resolve(path.dirname(configPath),config.flows[config.defaultFlow])),true); for(const profile of Object.values(config.qaProfiles))assert.deepEqual(profile.flows,[]); for(const [name,demo] of Object.entries(config.demos)){assert.ok(fs.existsSync(path.resolve(path.dirname(configPath),demo.file)),`missing demo ${name}`);assert.ok(['reels-9x16','landscape-16x9','square-1x1'].includes(demo.preset));assert.ok(Number.isFinite(demo.durationTargetSec)&&demo.durationTargetSec>0);} });

test('QA and demo flows use stable hooks and no embedded secrets', () => { const config=JSON.parse(fs.readFileSync(configPath,'utf8')); const files=Object.values(config.demos).map(demo=>demo.file); for(const flowPath of files){const flow=JSON.parse(fs.readFileSync(path.resolve(path.dirname(configPath),flowPath),'utf8'));assert.ok(Array.isArray(flow.steps)&&flow.steps.length>0);for(const step of flow.steps){assert.ok(!Object.prototype.hasOwnProperty.call(step,'password'));assert.ok(!Object.prototype.hasOwnProperty.call(step,'token'));if(step.holdMs!=null)assert.ok(Number.isFinite(step.holdMs)&&step.holdMs>=0);}} });
test('PDV quick demo defaults to a 30-second Reels deliverable', () => { const config=JSON.parse(fs.readFileSync(configPath,'utf8')); const demo=config.demos['quick-30s']; assert.equal(demo.preset,'reels-9x16'); assert.equal(demo.durationTargetSec,30); const flow=JSON.parse(fs.readFileSync(path.resolve(path.dirname(configPath),demo.file),'utf8')); assert.equal(flow.durationTargetSec,30); assert.ok(flow.steps.some(step=>step.name==='produtos')); assert.ok(flow.steps.some(step=>step.name==='balcao')); assert.ok(flow.steps.some(step=>step.name==='caixa')); assert.ok(flow.steps.some(step=>step.name==='relatorios')); });
test('vendored QA runtime is pinned to 2.6.0 and normalizes demo media duration', () => { const lock=JSON.parse(fs.readFileSync(path.join(root,'qa','artisys-qa.lock.json'),'utf8')); const runtimePackage=JSON.parse(fs.readFileSync(path.join(root,'qa','runtime','package.json'),'utf8')); const videoRuntime=fs.readFileSync(path.join(root,'qa','runtime','src','video.js'),'utf8'); const demoRuntime=fs.readFileSync(path.join(root,'qa','runtime','src','demo.js'),'utf8'); assert.equal(lock.schemaVersion,2); assert.equal(lock.version,'2.6.0'); assert.equal(lock.sourceCommit,'4a138a9d77775f5be1e43244b9d45ca8586742c5'); assert.equal(lock.sourceTree,'7da9ffa2a950c94072d29c5d3a89fc74696bcdd3'); assert.equal(runtimePackage.version,'2.6.0'); assert.match(videoRuntime,/ffprobe/); assert.match(videoRuntime,/setpts=/); assert.match(demoRuntime,/videoDurationSec/); });


test('partial Access Center QA flow covers manager and read-only capability boundaries',()=>{const config=JSON.parse(fs.readFileSync(configPath,'utf8'));const flowPath=config.flows['access-center-partial-permissions'];assert.ok(flowPath);const flow=JSON.parse(fs.readFileSync(path.resolve(path.dirname(configPath),flowPath),'utf8'));const names=new Set(flow.steps.map(step=>step.name));for(const name of ['gerente-central-carregada','gerente-pode-criar-pessoa','gerente-sem-tab-perfis','gerente-pessoa-editada','leitor-central-carregada','leitor-sem-criar-pessoa','leitor-sem-editar-pessoa'])assert.equal(names.has(name),true,name);});


test('ergonomic Access Center QA flow covers unified person/profile administration',()=>{
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  const flowPath=config.flows['access-center-ergonomic'];
  assert.ok(flowPath);
  const flow=JSON.parse(fs.readFileSync(path.resolve(path.dirname(configPath),flowPath),'utf8'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'ergonomic-central-carregada',
    'ergonomic-perfil-informacoes',
    'ergonomic-perfil-permissoes',
    'ergonomic-perfil-revisao',
    'ergonomic-perfil-criado',
    'ergonomic-pessoa-perfil-no-mesmo-fluxo',
    'ergonomic-exclusao-em-uso-bloqueada',
    'ergonomic-perfil-excluido'
  ])assert.equal(names.has(name),true,name);
});
