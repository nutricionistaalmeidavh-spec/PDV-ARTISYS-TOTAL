'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

function read(file){return fs.readFileSync(file,'utf8');}

test('ERP P0-P3 finance documentation describes the delivered management scope accurately',()=>{
  const architecture=read('docs/architecture/erp-finance-p0-p3.md');
  const operations=read('docs/operations/erp-finance.md');
  const readme=read('README.md');
  const capabilities=read('release/customer-capabilities.json');
  const combined=[architecture,operations,readme,capabilities].join('\n');
  for(const term of ['Gestão','DRE','Fluxo de caixa','OFX','Conciliação','Recorrências','Alertas']){
    assert.match(combined,new RegExp(term,'i'),`missing documented capability: ${term}`);
  }
  assert.match(combined,/confirma[cç][aã]o manual/i,'reconciliation must be documented as explicit/manual confirmation');
  assert.match(combined,/n[aã]o (?:implementa|substitui|inclui).*partidas dobradas/i,'scope must explicitly exclude double-entry accounting');
  assert.match(combined,/self-hosted/i,'core deployment model must remain self-hosted');
  assert.match(combined,/sem depend[eê]ncia paga obrigat[oó]ria/i,'paid services must not be a hidden dependency');
});