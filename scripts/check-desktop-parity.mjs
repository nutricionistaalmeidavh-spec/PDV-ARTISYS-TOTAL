// P0: auditable parity contract for seven screens PLUS every published desktop
// capability. Runs with Node 22, no proprietary service or remote network call.
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildScenarioCatalog,validateScenarioEvidence} from './parity-scenarios.mjs';
import {DESKTOP_SHA,DESKTOP_REPO,WEB_REPO,MODULES,STATUSES,requireProof,
  verifyClaim,verifyCapabilityInventory,verifyExecutableEvidence} from './parity-rules.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function checkedFile(path){
  requireProof(typeof path==='string' && path.length>0 && !path.includes('..') &&
    !path.startsWith('/') && !path.includes('\\'),'unsafe evidence path');
  const file=resolve(root,path);
  requireProof(!relative(root,file).split(sep).includes('..') && existsSync(file),'missing evidence '+path);
  return readFileSync(file,'utf8');
}
const json=path=>JSON.parse(checkedFile(path));
const matrix=json('docs/parity/desktop-web-matrix.json');
const inventory=json('docs/parity/desktop-capability-inventory.json');
const registry=json('docs/parity/scenario-evidence.json');
const scenarios=buildScenarioCatalog(matrix,inventory);
const scenarioStatus=validateScenarioEvidence(scenarios,registry,checkedFile);
const screenScenarios=scenarios.filter(s=>s.scope==='seven-screen-operations');
const validatedIds=new Set(registry.results.map(result=>result.scenarioId));
const screenScenariosComplete=screenScenarios.length>0 && screenScenarios.every(s=>validatedIds.has(s.id));
requireProof(scenarios.length>=496,'P0 requires at least four independently specified cases per pinned contract');
requireProof(scenarios.length===new Set(scenarios.map(s=>s.id)).size,'duplicate P0 scenario IDs');
const rawManifest=checkedFile('docs/parity/desktop-capabilities-baseline.json');
const blobHash=createHash('sha1').update('blob '+Buffer.byteLength(rawManifest)+'\0').update(rawManifest).digest('hex');
requireProof(blobHash==='191e0b30e872ea65b9d3b2853d29d4c05878a9cb',
  'published desktop capability snapshot does not match the pinned Git blob');
const manifest=JSON.parse(rawManifest);
requireProof(matrix.schemaVersion===2 && matrix.scope==='seven-screen-operations','wrong seven-screen parity schema');
requireProof(matrix.desktop.repo===DESKTOP_REPO && matrix.desktop.commit===DESKTOP_SHA,'untrusted desktop baseline');
requireProof(matrix.web.repo===WEB_REPO,'wrong SaaS repository');
requireProof(matrix.modules?.length===MODULES.length,'missing canonical seven-screen module');
const seen=new Set(), all=[],stats={covered:0,partial:0,gap:0};
for(const [index,module] of matrix.modules.entries()){
  requireProof(module.id===MODULES[index],'wrong or duplicate seven-screen module '+module.id);
  requireProof(module.desktopEvidence?.length>0 && module.contracts?.length>=3,
    'missing desktop evidence or operations for '+module.id);
  for(const row of module.contracts){
    requireProof(row.id?.startsWith(module.id+'-') && !seen.has(row.id),'duplicate or invalid canonical ID '+row.id);
    seen.add(row.id);all.push(row);
    requireProof(row.name?.length>=12 && row.acceptance?.length>=45,
      'missing operation description/acceptance '+row.id);
    requireProof(typeof row.owner==='string' && /^[a-z][a-z-]+$/.test(row.owner),
      'missing domain owner '+row.id);
    requireProof(Array.isArray(row.dependsOn) && new Set(row.dependsOn).size===row.dependsOn.length,
      'malformed dependencies '+row.id);
    requireProof(STATUSES.includes(row.status),'invalid parity status '+row.id);
    if(row.status!=='gap')verifyExecutableEvidence(row,checkedFile);
    else requireProof(!row.webEvidence,'gap must not claim implementation evidence '+row.id);
    stats[row.status]++;
  }
}
requireProof(all.length===68,'pinned seven-screen baseline must retain all 68 contracts');
const dependencies=new Map(all.map(row=>[row.id,row.dependsOn]));
for(const [id,deps] of dependencies)
  for(const dependency of deps)requireProof(dependencies.has(dependency) && dependency!==id,
    'unknown/self-referencing prerequisite '+id+': '+dependency);
const visiting=new Set(),visited=new Set();
function visit(id){
  if(visited.has(id))return;
  requireProof(!visiting.has(id),'cyclic canonical prerequisite '+id);
  visiting.add(id);
  for(const dep of dependencies.get(id))visit(dep);
  visiting.delete(id);visited.add(id);
}
for(const id of dependencies.keys())visit(id);
const sevenComplete=verifyClaim(all,matrix.parityClaim,matrix.certification||null,'seven-screen-operations',{scenarioEvidenceComplete:screenScenariosComplete});
const extra=verifyCapabilityInventory(matrix,inventory,manifest,{scenarioEvidenceComplete:scenarioStatus.complete&&screenScenariosComplete,readSource:checkedFile});
const allComplete=sevenComplete && inventory.fullSystemClaim==='complete';
const readme=checkedFile('README.md');
if(!allComplete)requireProof(!/PARIDADE COMPLETA COM O DESKTOP|100% DE PARIDADE DESKTOP/i.test(readme),
  'README must not overstate unverified desktop/system parity');
console.log('Desktop reference: '+DESKTOP_REPO+'@'+DESKTOP_SHA);
console.log('Seven operational screens: '+all.length+' contracts; covered '+stats.covered+
  ', partial '+stats.partial+', gaps '+stats.gap);
console.log('P0 independently verified comparisons: '+scenarioStatus.verified+'/'+scenarioStatus.total+' scenarios');
console.log('Published desktop manifest: '+manifest.length+' capabilities; covered '+extra.covered+
  ', partial '+extra.partial+', gaps '+extra.gap);
for(const module of matrix.modules){
  const covered=module.contracts.filter(row=>row.status==='covered').length;
  console.log(' - '+module.label+': '+covered+'/'+module.contracts.length+' verified');
}
console.log(allComplete?
  'SYSTEM PARITY CERTIFIED: scope and independent CI attestation verified.':
  'SYSTEM PARITY INCOMPLETE: no unproven full-parity claims permitted.');
