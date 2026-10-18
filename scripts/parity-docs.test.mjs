// Guard against documentation claiming an outdated parity state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const project=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,project),'utf8');
const wave=(contracts,ids)=>contracts.filter(row=>ids.has(row.id));
const ids=(from,to)=>Array.from({length:to-from+1},(_,i)=>'cap-'+String(from+i).padStart(3,'0'));
const r1=new Set([...ids(4,8),...ids(11,24),'cap-040','cap-052']);
const r2=new Set([...ids(1,3),'cap-010','cap-042',...ids(44,47),'cap-051',...ids(53,56)]);
const r3=new Set([...ids(25,30),'cap-043','cap-050']);
const r4=new Set(['cap-009',...ids(31,39),'cap-041','cap-048','cap-049']);
const count=rows=>rows.reduce((out,row)=>(out[row.status]=(out[row.status]||0)+1,out),{covered:0,partial:0,gap:0});

test('roadmap and README reflect canonical 56 capabilities without reopening covered R1',async()=>{
  const [inventText,matrixText,roadmap,readme,peripherals]=await Promise.all([
    read('docs/parity/desktop-capability-inventory.json'),
    read('docs/parity/desktop-web-matrix.json'),
    read('docs/ROADMAP-PARIDADE-56.md'),read('README.md'),
    read('docs/WEB-PERIPHERALS.md')]);
  const rows=JSON.parse(inventText).contracts;
  const contracts=JSON.parse(matrixText).modules.flatMap(module=>module.contracts);
  assert.equal(rows.length,56);
  assert.equal(contracts.length,68);
  const total=count(rows),screen=count(contracts);
  const byWave=[r1,r2,r3,r4].map(group=>count(wave(rows,group)));
  assert.deepEqual([...r1,...r2,...r3,...r4].sort(),rows.map(row=>row.id).sort(),
    'roadmap waves must partition exactly the canonical 56 capabilities');
  assert.deepEqual(byWave[0],{covered:21,partial:0,gap:0},
    'R1 status changed: review acceptance and update documents before merging');
  assert.match(roadmap,new RegExp(total.covered+' cobertas, '+total.partial+
    ' parciais e '+total.gap+' não demonstradas'));
  assert.match(roadmap,new RegExp(screen.covered+' cobertos e '+screen.partial+' parciais'));
  assert.match(roadmap,/R1: manutenção e regressão, não nova implementação/);
  assert.equal(roadmap.includes('**Fechar R1:'),false);
  assert.ok(readme.includes('R2 — alternativa self-hosted / LAN (não bloqueia o SaaS):** '+byWave[1].covered+'/14'));
  assert.ok(readme.includes('R3 — periféricos:** '+byWave[2].partial+'/8'));
  assert.ok(readme.includes('R4 — alimentação e verticais:** '+byWave[3].covered+'/13'));
  assert.match(readme,/a loja pode operar sem Internet/);
  assert.match(readme,/Não há venda offline se a API estiver inacessível/);
  assert.ok(readme.includes('tools/local-hardware-bridge/'));
  assert.match(peripherals,/Aprimorar e certificar/);
  assert.equal(peripherals.includes('Criar agente local open source/self-hosted'),false);
});

test('roadmap and README prioritize hosted SaaS, keeping Windows LAN-only tasks out of release blockers',async()=>{
  const [roadmap,readme,scopeText,packageText]=await Promise.all([
    read('docs/ROADMAP-PARIDADE-56.md'),
    read('README.md'),
    read('docs/parity/saas-delivery-scope.json'),
    read('package.json')]);
  const scope=JSON.parse(scopeText),pkg=JSON.parse(packageText);
  assert.deepEqual(scope.deferredCapabilityIds.map(item=>item.id),['cap-001','cap-047','cap-056']);
  assert.equal(pkg.scripts['report:saas'],'node scripts/p6-capability-report.mjs --saas');
  assert.match(roadmap,/Não exige instalador, servidor local nem topologia LAN/);
  assert.match(roadmap,/R2: nenhuma pendência obrigatória para o lançamento do SaaS hospedado/);
  assert.match(roadmap,/Não depende de 56\/56 referências desktop/);
  assert.match(readme,/SaaS web\/PWA por HTTPS/);
  assert.match(readme,/53 referências aplicáveis ao escopo web/);
  assert.match(readme,/Não exige instalar executável/);
  assert.doesNotMatch(roadmap,/R2: fechar apenas as três capacidades parciais/);
});
