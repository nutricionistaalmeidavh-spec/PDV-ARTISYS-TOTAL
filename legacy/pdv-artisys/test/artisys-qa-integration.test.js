import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve('.');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('pins synchronized ArtiSys QA runtime',()=>{
  const lock=readJson('qa/artisys-qa.lock.json');
  const runtime=readJson('qa/runtime/package.json');
  assert.equal(lock.schemaVersion,2);
  assert.equal(lock.module,'@artisys/qa');
  assert.equal(lock.version,'2.6.0');
  assert.equal(lock.sourceRepository,'nutricionistaalmeidavh-spec/utilidades');
  assert.equal(lock.consumption,'vendored-runtime');
  assert.equal(runtime.name,'@artisys/qa');
  assert.equal(runtime.version,'2.6.0');
});

test('vendors runtime capabilities used by CI',()=>{
  for(const relative of ['qa/runtime/src/cli.mjs','qa/runtime/src/profile-runner.js','qa/runtime/src/profiles.js','qa/runtime/src/remote-control.js','qa/runtime/src/agent-cli.mjs','qa/runtime/src/telemetry-store.js','qa/runtime/src/release-gate.js','qa/runtime/src/product-report.js']) assert.equal(fs.existsSync(path.join(root,relative)),true,relative);
  assert.equal(fs.existsSync(path.join(root,'qa/runtime/src/visual.js')),false);
  assert.match(readText('qa/runtime/src/profile-runner.js'),/writeCiQaSummary/);
});

test('legacy QA profiles stay retired while the current P0 UI smoke is an active CI gate',()=>{
  const pkg=readJson('package.json');
  const github=readText('.github/workflows/verify.yml');
  const circle=readText('.circleci/config.yml');
  for(const script of ['qa:quick','qa:full','qa:release','qa:crosscut','qa:remote','qa:ux:finalize']) assert.equal(pkg.scripts[script],undefined,`${script} should be retired`);
  assert.equal(typeof pkg.scripts['qa:validate'],'string');
  assert.match(pkg.scripts['qa:e2e:p0'],/all-pages-audit/);
  assert.match(pkg.scripts['qa:e2e:p0'],/compactDesktop/);
  assert.match(github,/ui-e2e:/);
  assert.match(github,/xvfb-run -a npm run qa:e2e:p0/);
  assert.doesNotMatch(github,/qa:release|qa:full|qa:crosscut|fiscal:certify/);
  assert.doesNotMatch(circle,/qa:quick|qa_smoke/);
});

test('future QA updates remain explicit and local-first',()=>{
  const pkg=readJson('package.json');
  assert.equal(pkg.scripts['qa:update'],'node scripts/sync-artisys-qa.mjs');
  assert.equal(pkg.scripts['qa:validate'],'node qa/runtime/artisys-qa.mjs validate --config qa/artisys-qa.config.json');
  assert.equal(pkg.scripts['qa:e2e:p0'],'node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow all-pages-audit --environment ci --viewport compactDesktop --output qa-artifacts');
  const sync=readText('scripts/sync-artisys-qa.mjs');
  assert.match(sync,/ARTISYS_QA_SOURCE/);
  assert.match(sync,/qa\/artisys-qa\.config\.json/);
});

test('CircleCI verifies release without launching a legacy QA flow',()=>{
  const circle=readText('.circleci/config.yml');
  assert.match(circle,/command: npm run verify:release/);
  assert.doesNotMatch(circle,/qa:quick|qa_smoke/);
});

test('GitHub QA capture is manual demo-only and cannot run legacy E2E flows',()=>{
  const workflow=readText('.github/workflows/qa-capture.yml');
  assert.match(workflow,/artisys-qa\.mjs demo/);
  assert.doesNotMatch(workflow,/artisys-qa\.mjs run/);
  assert.doesNotMatch(workflow,/pull_request:|^  push:/m);
});


test('current Electron QA manifest uses the isolated QA desktop wrapper',()=>{
  const config=readJson('qa/artisys-qa.config.json');
  assert.equal(config.electron.entry,'desktop/main.cjs');
  assert.equal(fs.existsSync(path.join(root,'qa/desktop/main.cjs')),true);
  const flow=readJson('qa/flows/all-pages-audit.json');
  assert.equal(flow.metadata.qaAutoAdmin,true);
  assert.equal(flow.steps.some(step=>step.action==='expectNoHorizontalOverflow'),true);
  assert.equal(flow.steps.some(step=>step.name==='balcao-finalizar-visivel'),true);
});
