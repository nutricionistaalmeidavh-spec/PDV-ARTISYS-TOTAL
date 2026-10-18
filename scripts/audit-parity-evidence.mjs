// Offline P0 evidence report. Never claims that an unexecuted scenario passed.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildScenarioCatalog,validateScenarioEvidence} from './parity-scenarios.mjs';
import {DESKTOP_SHA,requireProof} from './parity-rules.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>{
  requireProof(typeof path==='string'&&/^[a-z0-9_./-]+$/.test(path)&&
    !path.includes('..')&&!path.startsWith('/'),'unsafe P0 evidence path');
  return readFileSync(resolve(root,path),'utf8');
};
const json=path=>JSON.parse(read(path));
const matrix=json('docs/parity/desktop-web-matrix.json');
const inventory=json('docs/parity/desktop-capability-inventory.json');
const registry=json('docs/parity/scenario-evidence.json');
const scenarios=buildScenarioCatalog(matrix,inventory);
const results=validateScenarioEvidence(scenarios,registry,read);
const verified=new Map(registry.results.map(result=>[result.scenarioId,result]));
const report={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  gitCommit:process.env.GITHUB_SHA||null,
  desktop:{repo:'nutricionistaalmeidavh-spec/PDV-ARTISYS',commit:DESKTOP_SHA,
    pricingSourceBlobSha:'165bfb0af4aa4764474f421cc04f0c32f1b71fb8'},
  contractTotals:{operational:matrix.modules.reduce((n,m)=>n+m.contracts.length,0),
    capabilities:inventory.contracts.length},
  contractStatuses:{
    operational:Object.fromEntries(['covered','partial','gap'].map(s=>[s,matrix.modules.flatMap(m=>m.contracts).filter(r=>r.status===s).length])),
    capabilities:Object.fromEntries(['covered','partial','gap'].map(s=>[s,inventory.contracts.filter(r=>r.status===s).length]))
  },
  scenarioTotals:results,
  scopeResults:Object.fromEntries(['seven-screen-operations','full-desktop'].map(scope=>{
    const subset=scenarios.filter(s=>s.scope===scope);
    const passed=subset.filter(s=>verified.has(s.id)).length;
    return [scope,{required:subset.length,verified:passed,pending:subset.length-passed}];
  })),
  claimStatus:{operational:matrix.parityClaim,fullDesktop:inventory.fullSystemClaim},
  note:'Verified scenario count requires independent full desktop vs web proof. Existing narrower tests do not automatically certify whole scenarios.',
  scenarios:scenarios.map(s=>({...s,state:verified.has(s.id)?'verified-by-evidence':'pending-independent-comparison',
    evidence:verified.get(s.id)||null}))
};
requireProof(report.contractTotals.operational===68&&report.contractTotals.capabilities===56,'P0 baseline drift');
const out=resolve(root,'qa-artifacts/parity');
mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,'audit-summary.json'),JSON.stringify({
  schemaVersion:report.schemaVersion,generatedAt:report.generatedAt,gitCommit:report.gitCommit,
  desktop:report.desktop,contractTotals:report.contractTotals,contractStatuses:report.contractStatuses,
  scenarioTotals:report.scenarioTotals,scopeResults:report.scopeResults,claimStatus:report.claimStatus,
  note:report.note
},null,2)+'\n');
writeFileSync(resolve(out,'scenario-catalog.json'),JSON.stringify(report,null,2)+'\n');
console.log('P0 parity audit evidence saved to qa-artifacts/parity/: '+results.total+
  ' planned scenarios, '+results.verified+' independently verified, '+results.pending+' pending.');
