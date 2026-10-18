import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIELD_OPTIONAL_CAPS} from './parity-rules.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const LAN=new Set([1,2,3,10,42,44,45,46,47,51,53,54,55,56].map(n=>'cap-'+String(n).padStart(3,'0')));
const HARDWARE=new Set([25,26,27,28,29,30,43,50].map(n=>'cap-'+String(n).padStart(3,'0')));
const FOOD=new Set([9,31,32,33,34,35,36,37,38,39,41,48,49].map(n=>'cap-'+String(n).padStart(3,'0')));

const LABELS=Object.freeze({
  integral:'Copiado integralmente',
  parcial:'Copiado parcialmente',
  nao_copiado:'Não copiado / não demonstrado',
  aguardando_homologacao:'Implementado, aguardando auditoria de código'
});
const WAVE_LABELS=Object.freeze({
  R1:'Operação comercial canônica (balcão, estoque, caixa e financeiro)',
  R2:'Rede local e operação self-hosted multiusuário',
  R3:'Periféricos, protocolos simulados e integração local',
  R4:'Restaurante, KDS, delivery e segmentos especializados'
});

function group(id){
  return LAN.has(id)?'infra-lan-selfhost':HARDWARE.has(id)?'perifericos':
    FOOD.has(id)?'alimentacao-verticais':'catalogo-operacoes';
}
function wave(id){
  const g=group(id);
  return g==='infra-lan-selfhost'?'R2':g==='perifericos'?'R3':g==='alimentacao-verticais'?'R4':'R1';
}
function readyForHomologation(cap,prerequisites){
  const review=cap.implementationReview;
  return cap.status==='partial' && prerequisites.length===0 &&
    review?.state==='ready-for-homologation' &&
    typeof review.reviewer==='string' && review.reviewer.trim().length>=3 &&
    /^\d{4}-\d\d-\d\d$/.test(review.reviewedAt||'') &&
    Array.isArray(review.testFiles) && review.testFiles.length>0 &&
    review.testFiles.every(p=>typeof p==='string' && /^((apps|packages|scripts)\/)[a-zA-Z0-9_./-]+\.test\.(mjs|js)$/.test(p));
}
function classify(cap,prerequisites){
  // Never infer completed implementation from some passing contracts or a file name.
  if(cap.status==='covered')return {classification:'integral',certainty:'certificado',blockerType:'nenhum'};
  if(readyForHomologation(cap,prerequisites))
    return {classification:'aguardando_homologacao',certainty:'revisao-de-implementacao',blockerType:'auditoria-de-codigo'};
  if(cap.status==='partial')
    return {classification:'parcial',certainty:'evidencia-parcial',blockerType:'implementacao'};
  // "gap" means *no certified parity evidence*, NOT proof that the code does not exist.
  return {classification:'nao_copiado',certainty:'sem-evidencia-de-equivalencia',blockerType:'levantamento'};
}

export function buildReport(matrix,inventory){
  const contracts=matrix.modules.flatMap(m=>m.contracts);
  const contractStatus=new Map(contracts.map(c=>[c.id,c.status]));
  const counts={covered:0,partial:0,gap:0};
  const progressCounts={integral:0,parcial:0,nao_copiado:0,aguardando_homologacao:0};
  const groups={};
  const waves={R1:[],R2:[],R3:[],R4:[]};
  const rows=inventory.contracts.map(cap=>{
    if(!(cap.status in counts))throw Error('Invalid status: '+cap.id);
    counts[cap.status]++;
    const front=group(cap.id);
    const stage=wave(cap.id);
    const prerequisites=cap.dependsOn.filter(id=>contractStatus.get(id)!=='covered');
    const {classification,certainty,blockerType}=classify(cap,prerequisites);
    progressCounts[classification]++;
    const blockers=[];
    if(classification==='nao_copiado')
      blockers.push('levantamento de implementacao e equivalencia pendente; nao significa codigo ausente');
    if(classification==='parcial')blockers.push('fluxos incompletos ou sem equivalencia demonstrada');
    if(classification==='aguardando_homologacao')blockers.push('auditoria de paridade e certificacao de codigo pendentes');
    if(prerequisites.length)blockers.push('dependencias incompletas: '+prerequisites.join(', '));
    if(!cap.independentEvidence)blockers.push('cenario independente por ID ausente');
    // Field inspections are optional post-code deployment checks, never backlog blockers.
    const fieldValidation={applicable:FIELD_OPTIONAL_CAPS.has(cap.id),
      status:cap.fieldVerification?.status==='FIELD_VERIFIED'?'verified':'not-verified',
      requiredForCodeReady:false};
    const linkedContracts=cap.dependsOn.map(id=>({id,status:contractStatus.get(id)||'nao-catalogado'}));
    const result={id:cap.id,name:cap.capability,front,wave:stage,
      status:cap.status,classification,classificationLabel:LABELS[classification],
      certainty,blockerType,linkedContracts,blockers,
      codeReady:cap.status==='covered',fieldValidation};
    (groups[front]??=[]).push(result);
    waves[stage].push(result);
    return result;
  });
  if(rows.length!==56||new Set(rows.map(c=>c.id)).size!==56)
    throw Error('P6 requires exactly 56 unique canonical capabilities');
  return {
    scope:'desktop-extended-parity',fullSystemClaim:inventory.fullSystemClaim,
    // One public management backlog: 56 capabilities. Contract IDs are internal diagnostics.
    progress:{
      total:56,codeReady:counts.covered,counts:progressCounts,labels:LABELS,
      notes:[
        'Os 68 contratos detalham criterios e testes das mesmas capacidades; nao sao outra lista de funcionalidades.',
        'O estado gap nao comprova ausencia de codigo: nao copiado/nao demonstrado exige triagem antes de afirmar inexistencia.',
        'Aguardando auditoria de codigo exige revisao explicita, testes identificados e dependencias cobertas; inspeção em campo e opcional.',
        'Copiado integralmente exige status covered baseado em evidencia automatizada e revisao independente de codigo; teste fisico nao e bloqueio.'
      ]
    },
    contractDiagnostics:{
      total:contracts.length,covered:contracts.filter(c=>c.status==='covered').length,
      partial:contracts.filter(c=>c.status==='partial').length,
      gap:contracts.filter(c=>c.status==='gap').length
    },
    roadmap:{labels:WAVE_LABELS,waves},
    // Keep old fields for scripts/tests depending on the internal auditing format.
    summary:{total:56,...counts},
    sevenScreens:{total:contracts.length,covered:contracts.filter(c=>c.status==='covered').length},
    groups,rows
  };
}
export function buildSaasDeliveryReport(historical,scope){
  if(scope?.schemaVersion!==1||scope?.primaryDelivery!=='hosted-https-web-api'
    ||!Array.isArray(scope.deferredCapabilityIds))throw Error('Invalid SaaS delivery scope manifest.');
  if(historical.rows?.length!==56)throw Error('Expected exactly 56 historical desktop capabilities.');
  const all=new Map(historical.rows.map(row=>[row.id,row]));
  const deferred=new Set(),items=[];
  for(const entry of scope.deferredCapabilityIds){
    if(!/^cap-\d{3}$/.test(entry?.id||''))throw Error('Invalid deferred capability ID.');
    if(deferred.has(entry.id))throw Error('Duplicate deferred capability: '+entry.id);
    const cap=all.get(entry.id);
    if(!cap)throw Error('Unknown deferred capability: '+entry.id);
    if(cap.status==='covered')throw Error('Do not hide an already covered capability from the SaaS scope: '+entry.id);
    if(typeof entry.reason!=='string'||entry.reason.length<25)throw Error('Missing deferred rationale: '+entry.id);
    deferred.add(entry.id);
    items.push({...cap,reason:entry.reason});
  }
  const active=historical.rows.filter(row=>!deferred.has(row.id));
  const counts={covered:0,partial:0,gap:0};
  for(const row of active)counts[row.status]++;
  return {
    product:scope.primaryProduct,primaryDelivery:scope.primaryDelivery,
    primaryRuntime:scope.primaryRuntime,optionalRuntime:scope.optionalRuntime,
    defaultClient:scope.defaultClient,releasePolicy:scope.releasePolicy,
    active:{total:active.length,counts,pending:active.filter(row=>row.status!=='covered')},
    deferred:{total:items.length,ids:items.map(row=>row.id).sort(),items},
    historical:{total:historical.summary.total,counts:{
      covered:historical.summary.covered,partial:historical.summary.partial,gap:historical.summary.gap
    }},
    note:'Itens historicos de LAN/Windows foram mantidos no inventario, mas nao bloqueiam o SaaS hospedado. O numero de capacidades desktop nao substitui gates de SaaS, autenticacao, pagamento e implantacao.'
  };
}
function printSaasHuman(saas){
  console.log('PDV TOTAL — ENTREGA PRINCIPAL: WEB / SAAS (navegador + HTTPS; sem instalador)');
  console.log('Referencias de desktop no escopo web: '+saas.active.total+
    ' | cobertas '+saas.active.counts.covered+' | parciais '+saas.active.counts.partial+
    ' | gap '+saas.active.counts.gap);
  console.log('Recursos opcionais de instalacao local/LAN fora do bloqueio SaaS: '+
    saas.deferred.ids.join(', '));
  console.log('\nPendencias reais do escopo web:');
  for(const row of saas.active.pending)
    console.log('- '+row.id+' '+row.name+' ['+row.status+']');
  console.log('\nA auditoria historica completa continua com 56 IDs. Prontidao SaaS requer QA de seguranca, deploy e jornadas web, alem destas referencias.');
}
function printSaasMarkdown(saas){
  console.log('# PDV TOTAL — pendencias WEB/SAAS (navegador)\n');
  console.log('| Referencias desktop aplicaveis | Cobertas | Parciais | Sem prova | Opcionais fora do bloqueio |');
  console.log('|---:|---:|---:|---:|---:|');
  console.log('| '+saas.active.total+' | '+saas.active.counts.covered+' | '+saas.active.counts.partial+
    ' | '+saas.active.counts.gap+' | '+saas.deferred.total+' |\n');
  console.log('| ID | Pendencia funcional web | Estado |\n|---|---|---|');
  for(const row of saas.active.pending)console.log('| '+row.id+' | '+row.name+' | '+row.status+' |');
  console.log('\nOpcionais de LAN/desktop: '+saas.deferred.ids.join(', ')+
    '. Sem obrigatoriedade de instalar servidor Windows/terminal ou usar rede local para o SaaS.');
}
function printHuman(report){
  if(report.saasDelivery){printSaasHuman(report.saasDelivery);console.log('\n--- Inventario historico, NAO fila de entrega SaaS ---\n');}
  console.log('PDV TOTAL — painel de auditoria historica: '+report.progress.total+' capacidades do desktop');
  for(const [key,label] of Object.entries(report.progress.labels))
    console.log(' - '+label+': '+report.progress.counts[key]);
  console.log('\nOs '+report.contractDiagnostics.total+' contratos sao criterios internos ('+
    report.contractDiagnostics.covered+' cobertos; '+report.contractDiagnostics.partial+
    ' parciais; '+report.contractDiagnostics.gap+' gaps), NAO funcionalidades adicionais.');
  console.log('Cuidado: gap nao prova ausencia de codigo. Certificacao do desktop: '+report.fullSystemClaim);
  for(const [stage,rows] of Object.entries(report.roadmap.waves)){
    console.log('\n'+stage+' — '+report.roadmap.labels[stage]+' ('+rows.length+' capacidades)');
    for(const c of rows){
      console.log('- '+c.id+' '+c.name+' ['+c.classificationLabel+']'+
        (c.blockers.length?' — '+c.blockers.join('; '):''));
    }
  }
}
function printMarkdown(report){
  if(report.saasDelivery){printSaasMarkdown(report.saasDelivery);console.log('\n---\n');}
  console.log('# Paridade historica do desktop — 56 capacidades\n');
  console.log('| Estado | Quantidade |\n|---|---:|');
  for(const [key,label] of Object.entries(report.progress.labels))
    console.log('| '+label+' | '+report.progress.counts[key]+' |');
  console.log('\n> Os 68 contratos sao criterios internos. "Nao copiado / nao demonstrado" NAO prova ausencia de codigo.\n');
  for(const [stage,rows] of Object.entries(report.roadmap.waves)){
    console.log('## '+stage+' — '+report.roadmap.labels[stage]+'\n');
    console.log('| ID | Capacidade | Estado | Bloqueio principal |\n|---|---|---|---|');
    for(const c of rows)
      console.log('| '+c.id+' | '+c.name+' | '+c.classificationLabel+' | '+c.blockers[0]+' |');
    console.log('');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const matrix=JSON.parse(readFileSync(resolve(ROOT,'docs/parity/desktop-web-matrix.json'),'utf8'));
  const inventory=JSON.parse(readFileSync(resolve(ROOT,'docs/parity/desktop-capability-inventory.json'),'utf8'));
  const report=buildReport(matrix,inventory);
  const scope=JSON.parse(readFileSync(resolve(ROOT,'docs/parity/saas-delivery-scope.json'),'utf8'));
  report.saasDelivery=buildSaasDeliveryReport(report,scope);
  const saasOnly=process.argv.includes('--saas');
  if(process.argv.includes('--json'))console.log(JSON.stringify(saasOnly?report.saasDelivery:report,null,2));
  else if(process.argv.includes('--markdown'))saasOnly?printSaasMarkdown(report.saasDelivery):printMarkdown(report);
  else saasOnly?printSaasHuman(report.saasDelivery):printHuman(report);
}
