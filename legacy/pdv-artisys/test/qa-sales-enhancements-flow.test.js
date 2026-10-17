'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('seller selector synchronizes backend users when checkout is rendered',()=>{
  const source=readText('desktop/renderer/seller-select-sync.js');
  assert.match(source,/seller-select/);
  assert.match(source,/api\.sellers\(\)/);
  assert.match(source,/replaceChildren/);
});

test('QA Electron launcher isolates userData through QA wrapper',()=>{
  const config=readJson('qa/artisys-qa.config.json');
  assert.equal(config.electron.entry,'desktop/main.cjs');
  const launcher=readText('qa/desktop/main.cjs');
  assert.match(launcher,/ARTISYS_QA/);
  assert.match(launcher,/app\.setPath\(['"]userData['"]/);
  assert.match(launcher,/os\.tmpdir\(\)/);
  assert.match(launcher,/require\(['"]\.\.\/\.\.\/desktop\/main\.cjs['"]\)/);
  const cli=readText('qa/runtime/src/cli-core.mjs');
  assert.match(cli,/runQaFlow\([\s\S]*onProgress:\s*progressLog/);
  const runner=readText('qa/runtime/src/runner.js');
  assert.match(runner,/setDefaultTimeout\(manifest\.actionTimeoutMs \|\| 15000\)/);
  assert.match(runner,/flow\.metadata\?\.qaAutoAdmin === true/);
  const desktopMain=readText('desktop/main.cjs');
  assert.match(desktopMain,/!app\.isPackaged[\s\S]{0,180}ARTISYS_QA === '1'[\s\S]{0,180}ARTISYS_QA_AUTO_ADMIN === '1'/);
  assert.equal(config.environments.ci.env.PDV_ENABLE_LAN,'false');
  assert.equal(config.environments.ci.env.PDV_AUTO_PRINT,'false');
  assert.equal(config.environments.ci.env.PDV_REQUIRE_COMMERCIAL_ACTIVATION,'false');
});
