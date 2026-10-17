'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const json=rel=>JSON.parse(read(rel));

test('semantic QA gate covers scanner, PDF semantics and machine-readable artifacts without visual baselines',()=>{
  const pkg=json('package.json');
  const config=json('qa/artisys-qa.config.json');
  const workflow=read('.github/workflows/verify.yml');
  assert.equal(config.environments?.ci?.env?.ARTISYS_QA_PDF_DIR,'../qa-artifacts/pdf');
  const steps=read('qa/runtime/src/steps.js');
  const runner=read('qa/runtime/src/runner.js');
  const flowPath=config.flows?.['semantic-regression'];
  assert.equal(flowPath,'flows/semantic-regression-e2e.json');
  const flow=json(path.join('qa',flowPath));
  const actions=new Set(flow.steps.map(step=>step.action));
  const names=new Set(flow.steps.map(step=>step.name));
  assert.ok(actions.has('barcodeScan'),'scanner must be exercised as keyboard-wedge input');
  assert.ok(actions.has('clickIfVisible'),'cash-open branch must be handled deterministically');
  assert.ok(actions.has('expectCount'),'scanner flow must prove exact-match/non-match behavior');
  assert.ok(actions.has('expectPdfText'),'generated PDF must be checked semantically');
  assert.ok(names.has('barcode-exato-localizado'));
  assert.ok(names.has('barcode-invertido-nao-localiza'));
  assert.ok(names.has('pdf-conteudo-semanticamente-valido'));
  assert.match(steps,/case 'barcodeScan'/);
  assert.match(steps,/case 'clickIfVisible'/);
  assert.match(steps,/dispatchEvent\(new MouseEvent\('click'/);
  assert.match(steps,/case 'expectPdfText'/);
  assert.match(runner,/env: runtimeEnv/);
  assert.match(pkg.scripts['qa:e2e:semantic'],/semantic-regression/);
  assert.match(pkg.scripts['qa:artifact-semantic'],/artifact-roundtrip/);
  assert.match(workflow,/qa:e2e:semantic/);
  assert.match(workflow,/qa:artifact-semantic/);
  assert.match(workflow,/qa:multi-device/);
  assert.doesNotMatch(workflow,/visual-baselines|toMatchSnapshot|pixelmatch|visualSnapshot/);
});

test('customer operation registry requires permission and executable QA evidence for every exposed operation',()=>{
  const registry=json('release/customer-operations.json');
  const validator=read('scripts/check-customer-capability-parity.js');
  for(const operation of registry.operations){
    if(operation.exposure==='internal')continue;
    assert.ok(Array.isArray(operation.permissions)&&operation.permissions.length>0,operation.id+' missing permissions');
    assert.ok(Array.isArray(operation.qa)&&operation.qa.length>0,operation.id+' missing qa evidence');
    for(const evidence of operation.qa){
      assert.equal(typeof evidence.path,'string',operation.id+' qa path');
      assert.equal(typeof evidence.marker,'string',operation.id+' qa marker');
    }
  }
  assert.match(validator,/['"]qa['"]/);
  assert.match(validator,/permissions/);
});
