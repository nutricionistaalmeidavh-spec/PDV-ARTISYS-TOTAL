'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('CI reports built-in Node test coverage and preserves the report as evidence',()=>{
  const workflow=read('.github/workflows/verify.yml');
  assert.match(workflow,/--experimental-test-coverage/);
  assert.match(workflow,/coverage\/test-coverage\.txt/);
  assert.match(workflow,/code-coverage-/);
});

test('legacy visual comparisons are not active in CI',()=>{
  const verify=read('.github/workflows/verify.yml');
  assert.doesNotMatch(verify,/qa:release|qa:full|qa:crosscut|visualSnapshot|visual-baselines/);
  const runtime=read('qa/runtime/src/steps.js');
  const cli=read('qa/runtime/src/cli-core.mjs');
  const remote=read('qa/runtime/src/remote-control.js');
  assert.doesNotMatch(runtime,/visualSnapshot|validateVisualSnapshot|visual-baselines/);
  assert.doesNotMatch(cli,/update-visual-baselines|ARTISYS_QA_VISUAL/);
  assert.doesNotMatch(remote,/Validação visual|visual:/i);
  assert.equal(fs.existsSync(path.join(root,'.github/workflows/qa-visual.yml')),false);
  assert.equal(fs.existsSync(path.join(root,'qa/visual-baselines/classic-home-critical.png')),false);
  assert.equal(fs.existsSync(path.join(root,'qa/visual-baselines/checkout-critical.png')),false);
  assert.equal(fs.existsSync(path.join(root,'qa/runtime/src/visual.js')),false);
});

test('customer bugs have a permanent regression policy and PR checklist',()=>{
  const policy=read('docs/qa/customer-regression-policy.md');
  const template=read('.github/pull_request_template.md');
  assert.match(policy,/teste de regress[aã]o/i);
  assert.match(policy,/falh/i);
  assert.match(template,/bug.*cliente/i);
  assert.match(template,/regress[aã]o/i);
});

test('dependency security scan is pinned to OSV Scanner v2.6.0',()=>{
  const workflow=read('.github/workflows/osv-scanner.yml');
  assert.match(workflow,/google\/osv-scanner-action/);
  assert.match(workflow,/@v2\.6\.0/);
});
