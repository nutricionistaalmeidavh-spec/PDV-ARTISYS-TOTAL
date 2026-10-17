// Auditable parity guard. The original desktop repository is referenced only
// by its immutable commit: it is NEVER copied, built or mutated by this script.
// A passing assertion means claims and proofs are internally consistent; it
// DOES NOT mean every desktop feature has parity.
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,relative,sep} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const filepath=resolve(root,'docs/parity/desktop-web-matrix.json');
const data=JSON.parse(readFileSync(filepath,'utf8'));
const assert=(value,message)=>{if(!value)throw Error('[PARITY] '+message);};
const modules=['home','checkout','products','history','cash','finance','reports'];
assert(data.desktop.commit==='7efea9c61f75be1536a1e516e917218f2b8bf2bf','unexpected desktop baseline');
assert(data.desktop.repo==='nutricionistaalmeidavh-spec/PDV-ARTISYS','wrong desktop baseline');
assert(data.web.repo==='nutricionistaalmeidavh-spec/PDV-ARTISYS-TOTAL','wrong SaaS repo');
assert(data.modules?.length===modules.length,'seven module contracts must be present');
const seen=new Set();
const stats={covered:0,partial:0,gap:0};
function checkedFile(path){
  assert(typeof path==='string'&&path&&!path.includes('..')&&!path.startsWith('/'),'unsafe path');
  const file=resolve(root,path);
  assert(relative(root,file).split(sep)[0]!=='..'&&existsSync(file),'missing source '+path);
  return readFileSync(file,'utf8');
}
for(const [index,module] of data.modules.entries()){
  assert(module.id===modules[index],'wrong or duplicate module '+module.id);
  assert(module.desktopEvidence?.length,'missing desktop evidence for '+module.id);
  assert(module.contracts?.length>=3,'insufficient parity inventory for '+module.id);
  for(const row of module.contracts){
    assert(row.id?.startsWith(module.id+'-')&&!seen.has(row.id),'duplicate/invalid contract '+row.id);
    seen.add(row.id);
    assert(row.name?.length>=12,'missing descriptive contract '+row.id);
    assert(['covered','partial','gap'].includes(row.status),'invalid status '+row.id);
    stats[row.status]++;
    if(row.status==='covered'||row.status==='partial'){
      const proof=row.webEvidence;
      assert(proof?.file&&proof.contains,'evidence is mandatory for '+row.id);
      const source=checkedFile(proof.file);
      assert(source.includes(proof.contains),'source proof missing: '+row.id+' ('+proof.file+')');
      if(proof.testFile){
        assert(proof.testContains,'missing test match '+row.id);
        const tests=checkedFile(proof.testFile);
        assert(tests.includes(proof.testContains),'test proof missing: '+row.id);
      }else assert(row.status!=='covered','covered requires explicit test evidence: '+row.id);
    }
    if(row.status==='gap')assert(!row.webEvidence,'gaps must not masquerade as implemented '+row.id);
  }
}
const incomplete=stats.gap+stats.partial>0;
assert(data.parityClaim===(incomplete?'incomplete':'complete'),
 'Parity claim exceeds verified module contracts.');
const readme=checkedFile('README.md');
assert(incomplete&&!/PARIDADE COMPLETA COM O DESKTOP|100% DE PARIDADE DESKTOP/i.test(readme),
 'full parity cannot be asserted while any contract is pending');
console.log('Desktop pinned:',data.desktop.repo+'@'+data.desktop.commit);
console.log('Parity verification: '+seen.size+' contracts; covered '+stats.covered+
 ', partial '+stats.partial+', gaps '+stats.gap);
for(const module of data.modules){
 const remaining=module.contracts.filter(row=>row.status!=='covered');
 console.log(' - '+module.label+': '+(module.contracts.length-remaining.length)+'/'+module.contracts.length+
  ' strictly covered; pending '+remaining.length);
}
console.log(incomplete?'PARITY BLOCKED: desktop/web equivalence NOT certified.':'All listed contracts covered. Re-run original desktop end-to-end parity QA.');
