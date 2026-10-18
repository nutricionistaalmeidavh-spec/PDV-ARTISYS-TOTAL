// Pure validation rules: CI executes these in node:test and against the checked-in
// Workerd, SQLite, browser and API test evidence. String presence alone is not proof.
export const DESKTOP_SHA='7efea9c61f75be1536a1e516e917218f2b8bf2bf';
export const DESKTOP_REPO='nutricionistaalmeidavh-spec/PDV-ARTISYS';
export const WEB_REPO='nutricionistaalmeidavh-spec/PDV-ARTISYS-TOTAL';
export const MODULES=['home','checkout','products','history','cash','finance','reports'];
export const STATUSES=['covered','partial','gap'];
// LAN, external device and local printing flows require a human hardware/device field test.
export const FIELD_REQUIRED_CAPS=new Set(['cap-001','cap-002','cap-003','cap-025','cap-026','cap-027','cap-028','cap-029','cap-030','cap-042','cap-043','cap-044','cap-045','cap-046','cap-047','cap-050','cap-056']);

export function requireProof(value,message){
  if(!value)throw Error('[PARITY] '+message);
}

export function verifyClaim(rows,claim,certification,scope){
  const complete=rows.length>0 && rows.every(row=>row.status==='covered');
  requireProof(claim===(complete?'complete':'incomplete'),
    scope+': claim must correspond to all verified contracts, not to a target percentage');
  if(complete){
    requireProof(certification?.scope===scope,'complete requires scope-specific independent certification');
    requireProof(certification?.desktopBaselineCommit===DESKTOP_SHA,'wrong certified desktop commit');
    requireProof(/^[a-f0-9]{40}$/.test(certification?.webCommit||''),'missing certified web commit SHA');
    requireProof(/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[0-9]+$/.test(certification?.testRunUrl||''),
      'complete requires an independently reviewable GitHub Actions test run');
    requireProof(typeof certification?.independentReviewer==='string' && certification.independentReviewer.trim().length>=3,
      'complete requires named independent review');
    requireProof(!Number.isNaN(Date.parse(certification?.verifiedAt||'')),'complete requires a verification date');
    requireProof(certification?.testSuitePassed===true,'complete requires a passed test suite attestation');
  }else{
    requireProof(certification==null,'incomplete cannot keep a stale certification');
  }
  return complete;
}

export function verifyCapabilityInventory(matrix,inventory,publishedCapabilities,readSource){
  requireProof(inventory?.schemaVersion===1,'unsupported published capability inventory');
  requireProof(inventory?.baseline?.repo===DESKTOP_REPO && inventory.baseline.commit===DESKTOP_SHA,
    'published capability source must stay pinned to the unmodified desktop');
  requireProof(inventory?.baseline?.manifest==='release/capabilities.json','wrong source manifest');
  requireProof(inventory?.web?.repo===WEB_REPO,'capability inventory references wrong web repo');
  const a=inventory.baseline.publishedCapabilities||[];
  requireProof(a.length===publishedCapabilities.length && inventory.baseline.sourceManifestCount===publishedCapabilities.length,
    'missing published desktop capabilities');
  requireProof(a.every((v,i)=>v===publishedCapabilities[i]),'published desktop baseline changed or reordered');
  const rows=inventory.contracts||[];
  requireProof(rows.length===a.length,'every published capability must have a canonical inventory entry');
  const statuses=new Map(matrix.modules.flatMap(module=>module.contracts).map(row=>[row.id,row.status]));
  const names=new Set(),ids=new Set(),counts={covered:0,partial:0,gap:0};
  for(const [i,row] of rows.entries()){
    requireProof(row.id==='cap-'+String(i+1).padStart(3,'0') && !ids.has(row.id),'duplicate/invalid capability ID');
    requireProof(row.capability===a[i] && !names.has(row.capability),'missing/duplicate published capability: '+row.id);
    requireProof(typeof row.owner==='string' && /^[a-z][a-z-]+$/.test(row.owner),'missing capability owner '+row.id);
    requireProof(typeof row.acceptance==='string' && row.acceptance.length>=35,'missing acceptance case '+row.id);
    requireProof(STATUSES.includes(row.status),'unsupported capability status '+row.id);
    requireProof(row.sourceEvidence?.repo===DESKTOP_REPO &&
      row.sourceEvidence?.commit===DESKTOP_SHA &&
      row.sourceEvidence?.file==='release/capabilities.json' &&
      row.sourceEvidence?.manifestIndex===i,'false desktop provenance '+row.id);
    requireProof(Array.isArray(row.dependsOn) && new Set(row.dependsOn).size===row.dependsOn.length &&
      row.dependsOn.every(id=>statuses.has(id)),'bad canonical dependencies '+row.id);
    const tested=row.testedContractRefs||[];
    requireProof(Array.isArray(tested) && new Set(tested).size===tested.length &&
      tested.every(id=>row.dependsOn.includes(id) && statuses.get(id)==='covered'),
      'capability refers to an unverified seven-screen proof '+row.id);
    if(row.status==='partial')requireProof(tested.length>0,'partial capability needs covered subset '+row.id);
    if(row.status==='gap')requireProof(tested.length===0,'gap incorrectly claims verified subflow '+row.id);
    if(row.status==='covered'){
      requireProof(row.dependsOn.every(id=>statuses.get(id)==='covered'),
        'covered capability relies on an incomplete prerequisite: '+row.id);
      requireProof(typeof readSource==='function',
        'covered capability requires locally checked executable evidence: '+row.id);
      requireProof(row.independentEvidence?.testContains?.includes(row.id),
        'covered capability needs a scenario specific to its canonical ID: '+row.id);
      verifyExecutableEvidence({id:row.id,status:'covered',webEvidence:row.independentEvidence},readSource);
      if(FIELD_REQUIRED_CAPS.has(row.id)){
        const field=row.fieldVerification;
        requireProof(field?.status==='FIELD_VERIFIED' &&
          typeof field.platform==='string' && field.platform.length>=3 &&
          typeof field.deviceModel==='string' && field.deviceModel.length>=3 &&
          typeof field.independentReviewer==='string' && field.independentReviewer.length>=3 &&
          !Number.isNaN(Date.parse(field.verifiedAt||'')) &&
          typeof field.evidenceFile==='string' && field.evidenceFile.startsWith('docs/parity/field-qa/'),
          'covered LAN/hardware capability requires independent FIELD_VERIFIED evidence: '+row.id);
        requireProof(readSource(field.evidenceFile).includes(row.id),
          'physical field QA report must name canonical capability: '+row.id);
      }
    }
    counts[row.status]++;names.add(row.capability);ids.add(row.id);
  }
  verifyClaim(rows,inventory.fullSystemClaim,inventory.certification||null,'full-desktop');
  return counts;
}

export function verifyExecutableEvidence(row,readSource){
  const proof=row.webEvidence;
  requireProof(proof?.file && proof?.contains,'missing implementation evidence '+row.id);
  requireProof(readSource(proof.file).includes(proof.contains),'implementation reference not found '+row.id);
  if(row.status!=='covered')return;
  requireProof(proof.testFile && proof.testContains && proof.testAssertionContains,
    'covered needs an executable assertion, not just matching source: '+row.id);
  const runner=proof.testFile==='scripts/web-browser-e2e.mjs'?'playwright':
    /^apps\/api\/test\/[^/]+\.test\.mjs$/.test(proof.testFile) ||
    /^packages\/core\/test\/[^/]+\.test\.js$/.test(proof.testFile)?'node-test':null;
  requireProof(runner && proof.testRunner===runner,'covered evidence must use executed Node/Chromium test suite '+row.id);
  const test=readSource(proof.testFile);
  requireProof(runner==='playwright'?test.includes('chromium.launch'):test.includes('test('),
    'test evidence not an executable scenario '+row.id);
  const position=test.indexOf(proof.testContains);
  requireProof(position>=0 && proof.testAssertionContains.length>=12 &&
    /^(?:await\s+)?assert\./.test(proof.testAssertionContains),
    'covered has no assertion reference '+row.id);
  const window=test.slice(position,position+8000);
  requireProof(window.includes(proof.testAssertionContains),
    'assertion not attached to named test scenario '+row.id);
}
