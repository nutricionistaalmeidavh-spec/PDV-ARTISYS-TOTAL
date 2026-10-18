// R0 is an implementation/evidence triage, not a claim of functional parity.
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReport} from './p6-capability-report.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const R1_IDS=Object.freeze([4,5,6,7,8,...Array.from({length:14},(_,i)=>i+11),40,52]
  .map(n=>'cap-'+String(n).padStart(3,'0')));
const LEVELS=['covered','partial','gap'];
const tally=rows=>({
  total:rows.length,
  covered:rows.filter(x=>x.status==='covered').length,
  partial:rows.filter(x=>x.status==='partial').length,
  gap:rows.filter(x=>x.status==='gap').length
});
function contractEvidence(c,exists){
  const file=c.webEvidence?.file||null;
  const testFile=c.webEvidence?.testFile||null;
  return {
    id:c.id,status:c.status,name:c.name,
    sourceFile:file,implementationExists:Boolean(file&&exists(file)),
    testFile,testFileExists:Boolean(testFile&&exists(testFile))
  };
}
export function buildR0Audit(matrix,inventory,exists=path=>existsSync(resolve(root,path))){
  if(!Array.isArray(inventory?.contracts)||inventory.contracts.length!==56||
      new Set(inventory.contracts.map(x=>x.id)).size!==56)
    throw Error('R0 exige 56 capacidades unicas');
  const allContracts=matrix?.modules?.flatMap(m=>m.contracts)||[];
  const byId=new Map(allContracts.map(c=>[c.id,c]));
  if(byId.size!==allContracts.length)throw Error('R0: contrato duplicado');
  const publicBoard=buildReport(matrix,inventory);
  const boardById=new Map(publicBoard.rows.map(row=>[row.id,row]));
  const all=inventory.contracts.map(cap=>{
    if(!LEVELS.includes(cap.status))throw Error('R0: status desconhecido '+cap.id);
    const refs=[...new Set([...(cap.dependsOn||[]),...(cap.testedContractRefs||[])])];
    for(const id of refs)if(!byId.has(id))
      throw Error('R0: contrato desconhecido '+id+' em '+cap.id);
    const linkedContracts=refs.map(id=>contractEvidence(byId.get(id),exists));
    const blockingContracts=(cap.dependsOn||[]).filter(id=>byId.get(id).status!=='covered');
    const evidence=linkedContracts.filter(x=>x.implementationExists);
    const classification=boardById.get(cap.id)?.classification||'nao_copiado';
    return {
      id:cap.id,capability:cap.capability,status:cap.status,
      classification,roadmap:boardById.get(cap.id).wave,
      linkedContracts,blockingContracts,
      codeEvidenceFound:evidence.length,
      needsImplementationReview:cap.status!=='covered',
      needsIndependentParityProof:!cap.independentEvidence,
      sourceDesktopFile:cap.sourceEvidence?.file||null,
      nextAction:cap.status==='gap'?'inspecionar-implementacao':
        blockingContracts.length?'completar-fluxos-e-provas':
        cap.status==='covered'?'manter-regressao':'confirmar-paridade-integral',
      note:cap.reviewNote||'Sem laudo funcional detalhado; inspecionar UI, API, SQL e comparativo com desktop.'
    };
  });
  const r1=R1_IDS.map(id=>{
    const cap=all.find(x=>x.id===id);
    if(!cap)throw Error('R0: falta ID R1 '+id);
    return cap;
  });
  return {
    schemaVersion:1,baseline:inventory.baseline?.commit||null,
    scope:'R0-full-inventory-and-R1-implementation-triage',
    summary:{all:tally(all),R1:tally(r1),contractsInternal:allContracts.length},
    disclaimer:'Um arquivo existente nao prova equivalencia e um gap nao comprova ausencia de codigo. Nenhuma capacidade e promovida sem teste comparativo, revisao e homologacao.',
    all,R1:r1
  };
}
function toMarkdown(report){
  const rows=report.R1.map(x=>{
    const tests=x.linkedContracts.filter(c=>c.testFileExists).length;
    const missing=x.blockingContracts.length?x.blockingContracts.join(', '):'Nenhum contrato dependente parcial';
    return '| '+x.id+' | '+x.capability+' | '+x.classification+
      ' | '+missing+' | '+tests+' | '+x.nextAction+' |';
  });
  return [
    '# Auditoria R0 / R1 — 56 capacidades, 68 contratos internos',
    '',
    '> '+report.disclaimer,'',
    'Cobertura declarada R1: '+report.summary.R1.covered+'/21 integral; '+
      report.summary.R1.partial+' parciais; '+report.summary.R1.gap+' sem paridade demonstrada.',
    '',
    '| ID | Capacidade | Classificação | Contratos bloqueadores | Testes referenciados presentes | Próxima ação |',
    '|---|---|---|---|---:|---|',...rows,''
  ].join('\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const matrix=JSON.parse(readFileSync(resolve(root,'docs/parity/desktop-web-matrix.json'),'utf8'));
  const inventory=JSON.parse(readFileSync(resolve(root,'docs/parity/desktop-capability-inventory.json'),'utf8'));
  const report=buildR0Audit(matrix,inventory);
  if(process.argv.includes('--json'))process.stdout.write(JSON.stringify(report,null,2)+'\n');
  else process.stdout.write(toMarkdown(report));
}
