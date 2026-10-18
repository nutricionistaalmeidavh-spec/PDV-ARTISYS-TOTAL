import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIELD_REQUIRED_CAPS} from './parity-rules.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const LAN=new Set([1,2,3,10,42,44,45,46,47,51,53,54,55,56].map(n=>'cap-'+String(n).padStart(3,'0')));
const HARDWARE=new Set([25,26,27,28,29,30,43,50].map(n=>'cap-'+String(n).padStart(3,'0')));
const FOOD=new Set([9,31,32,33,34,35,36,37,38,39,41,48,49].map(n=>'cap-'+String(n).padStart(3,'0')));
function group(id){
  return LAN.has(id)?'infra-lan-selfhost':HARDWARE.has(id)?'perifericos':
    FOOD.has(id)?'alimentacao-verticais':'catalogo-operacoes';
}
export function buildReport(matrix,inventory){
  const contractStatus=new Map(matrix.modules.flatMap(m=>m.contracts).map(c=>[c.id,c.status]));
  const counts={covered:0,partial:0,gap:0},groups={};
  const rows=inventory.contracts.map(cap=>{
    if(!(cap.status in counts))throw Error('Invalid status: '+cap.id);
    counts[cap.status]++;
    const front=group(cap.id);
    const prerequisites=cap.dependsOn.filter(id=>contractStatus.get(id)!=='covered');
    const blockers=[];
    if(cap.status!=='covered')blockers.push('equivalencia funcional e E2E pendentes');
    if(prerequisites.length)blockers.push('dependencias incompletas: '+prerequisites.join(', '));
    if(!cap.independentEvidence)blockers.push('cenario independente por ID ausente');
    if(FIELD_REQUIRED_CAPS.has(cap.id)&&cap.fieldVerification?.status!=='FIELD_VERIFIED')
      blockers.push('homologacao fisica LAN/dispositivo pendente');
    const result={id:cap.id,name:cap.capability,front,status:cap.status,blockers};
    (groups[front]??=[]).push(result);
    return result;
  });
  if(rows.length!==56||new Set(rows.map(c=>c.id)).size!==56)
    throw Error('P6 requires exactly 56 unique canonical capabilities');
  const contracts=matrix.modules.flatMap(m=>m.contracts);
  return {scope:'desktop-extended-parity',fullSystemClaim:inventory.fullSystemClaim,
    summary:{total:56,...counts},sevenScreens:{
      total:contracts.length,covered:contracts.filter(c=>c.status==='covered').length},
    groups,rows};
}
function printHuman(report){
  console.log('P6 — capacidades desktop ('+report.summary.covered+'/56 comprovadas; 68 contratos: '+
    report.sevenScreens.covered+'/'+report.sevenScreens.total+')');
  for(const [front,rows] of Object.entries(report.groups)){
    console.log('\n'+front+' — '+rows.filter(c=>c.status==='covered').length+'/'+rows.length+' comprovadas');
    for(const c of rows)console.log('- '+c.id+' '+c.name+' ['+c.status+']'+
      (c.blockers.length?' — '+c.blockers.join('; '):''));
  }
  console.log('\nDeclaração completa: '+report.fullSystemClaim);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const matrix=JSON.parse(readFileSync(resolve(ROOT,'docs/parity/desktop-web-matrix.json'),'utf8'));
  const inventory=JSON.parse(readFileSync(resolve(ROOT,'docs/parity/desktop-capability-inventory.json'),'utf8'));
  const report=buildReport(matrix,inventory);
  if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
  else printHuman(report);
}
