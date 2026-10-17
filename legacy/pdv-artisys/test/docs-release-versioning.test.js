'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('release checklist is version-neutral because release version is resolved dynamically',()=>{
  const checklist=read('release/release-checklist.md');
  assert.doesNotMatch(checklist,/^#.*\bv?\d+\.\d+\.\d+/m);
  assert.doesNotMatch(checklist,/ArtiSys-PDV-\d+\.\d+\.\d+-x64-Setup\.exe/);
  assert.match(checklist,/RELEASE_VERSION/);
  assert.match(checklist,/resolve-release-version\.js/);
});

test('docs consistency gate enforces version-neutral release checklist',()=>{
  const checker=read('scripts/check-docs-consistency.js');
  assert.match(checker,/assertReleaseChecklistVersionNeutral/);
  assert.ok(checker.includes("read('release/release-checklist.md')"));
});
