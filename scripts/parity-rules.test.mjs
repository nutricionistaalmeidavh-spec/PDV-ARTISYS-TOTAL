import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyClaim,verifyCapabilityInventory,verifyExecutableEvidence,DESKTOP_SHA,DESKTOP_REPO,WEB_REPO} from './parity-rules.mjs';

test('parity cannot become complete by flipping a label while even one contract is partial',()=>{
  assert.throws(()=>verifyClaim([{status:'covered'},{status:'partial'}],'complete',null,'seven-screen-operations'),/claim must correspond/);
});

test('68 of 68 covered can be certified when independent CI evidence is supplied',()=>{
  const evidence={scope:'seven-screen-operations',desktopBaselineCommit:DESKTOP_SHA,webCommit:'a'.repeat(40),
    testRunUrl:'https://github.com/owner/repo/actions/runs/1234',independentReviewer:'QA independent',
    verifiedAt:'2026-10-17',testSuitePassed:true};
  assert.equal(verifyClaim(Array.from({length:68},()=>({status:'covered'})),'complete',evidence,'seven-screen-operations'),true);
  assert.throws(()=>verifyClaim([{status:'covered'}],'complete',null,'seven-screen-operations'),/certification/);
});

test('covered status requires an actual executable test assertion next to its scenario',()=>{
  const row={id:'test-001',status:'covered',webEvidence:{file:'apps/api/src/a.mjs',contains:'saveSale',
    testFile:'apps/api/test/a.test.mjs',testContains:"test('saves exactly once'",
    testAssertionContains:'assert.equal(result.count,1)',testRunner:'node-test'}};
  const files={'apps/api/src/a.mjs':'export function saveSale() {}',
    'apps/api/test/a.test.mjs':"test('saves exactly once',()=>{ const result={count:1};assert.equal(result.count,1);});"};
  verifyExecutableEvidence(row,path=>files[path]);
  assert.throws(()=>verifyExecutableEvidence({...row,webEvidence:{...row.webEvidence,testAssertionContains:'assert.equal(result.count,2)'}},path=>files[path]),/assertion not attached/);
});

test('published desktop manifest prevents silently dropping a capability from the P0 inventory',()=>{
  const matrix={modules:[{contracts:[{id:'home-001',status:'covered'}]}]};
  const published=['catalog-products-customers-sellers'];
  const row={id:'cap-001',capability:published[0],owner:'catalog',dependsOn:['home-001'],status:'partial',
    testedContractRefs:['home-001'],sourceEvidence:{repo:DESKTOP_REPO,commit:DESKTOP_SHA,
      file:'release/capabilities.json',manifestIndex:0},
    acceptance:'Validate canonical catalog changes in executed integration and browser QA'};
  const inventory={schemaVersion:1,baseline:{repo:DESKTOP_REPO,commit:DESKTOP_SHA,
      manifest:'release/capabilities.json',publishedCapabilities:published,sourceManifestCount:1},
    web:{repo:WEB_REPO},contracts:[row],fullSystemClaim:'incomplete'};
  assert.equal(verifyCapabilityInventory(matrix,inventory,published).partial,1);
  assert.throws(()=>verifyCapabilityInventory(matrix,{...inventory,contracts:[]},published),/every published capability/);
  assert.throws(()=>verifyCapabilityInventory(matrix,inventory,[...published,'new-published-capability']),/missing published desktop capabilities/);
});


test('P6 covered LAN capability fails closed without a specific executable test and physical field report',()=>{
  const published=['desktop-windows-local-first'];
  const row={id:'cap-001',capability:published[0],owner:'operations',dependsOn:[],status:'covered',
    testedContractRefs:[],sourceEvidence:{repo:DESKTOP_REPO,commit:DESKTOP_SHA,
      file:'release/capabilities.json',manifestIndex:0},
    acceptance:'Offline storage, multi-device access, restoration and local service isolation are verified',
    independentEvidence:{file:'apps/api/src/p6.mjs',contains:'localFirst',
      testFile:'apps/api/test/p6.test.mjs',testContains:"test('cap-001 local first'",
      testAssertionContains:'assert.equal(result, true)',testRunner:'node-test'}};
  const inventory={schemaVersion:1,baseline:{repo:DESKTOP_REPO,commit:DESKTOP_SHA,
      manifest:'release/capabilities.json',publishedCapabilities:published,sourceManifestCount:1},
    web:{repo:WEB_REPO},contracts:[row],fullSystemClaim:'incomplete'};
  const matrix={modules:[]};
  const files={'apps/api/src/p6.mjs':'export const localFirst = true;',
    'apps/api/test/p6.test.mjs':"test('cap-001 local first',()=>{const result=true;assert.equal(result, true);});",
    'docs/parity/field-qa/cap-001.md':'Independent physical QA for cap-001 verified on actual LAN'};
  const readSource=path=>files[path]||'';
  assert.throws(()=>verifyCapabilityInventory(matrix,inventory,published,readSource),/FIELD_VERIFIED/);
  const withField={...row,fieldVerification:{status:'FIELD_VERIFIED',platform:'Linux',
    deviceModel:'physical laptop',independentReviewer:'Independent QA',verifiedAt:'2026-10-17',
    evidenceFile:'docs/parity/field-qa/cap-001.md'}};
  assert.equal(verifyCapabilityInventory(matrix,{...inventory,contracts:[withField]},published,readSource).covered,1);
  assert.throws(()=>verifyCapabilityInventory(matrix,{...inventory,contracts:[
    {...withField,independentEvidence:{...row.independentEvidence,
      testContains:"test('unrelated'"}}]},published,readSource),/canonical ID/);
  assert.throws(()=>verifyCapabilityInventory(matrix,{...inventory,contracts:[
    {...withField,independentEvidence:{...row.independentEvidence,
      testAssertionContains:'assert.equal(result, false)'}}]},published,readSource),/assertion not attached/);
});
