import { redactSecrets } from './redaction.js';
import fs from 'node:fs/promises';
import path from 'node:path';

function cleanCheck(input,index){
  const status=String(input?.status||'unknown').toLowerCase();
  return {
    name:String(input?.name||input?.flow||input?.check||('check-'+(index+1))),
    category:String(input?.category||'general'),
    status,
    critical:input?.critical!==false,
    durationMs:Number.isFinite(Number(input?.durationMs))?Number(input.durationMs):null,
    error:input?.error?String(input.error):null,
    details:input?.details??null,
  };
}
function safeArray(value){return Array.isArray(value)?value:[]}
function isoSlug(value){return String(value||'system').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'system'}
function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}

export function evaluateProductGate({
  checks=[],
  coverage=null,
  consoleErrors=[],
  networkErrors=[],
  findings=[],
  override=false,
  overrideReason=null,
  policy={},
}={}){
  const normalizedChecks=safeArray(checks).map(cleanCheck);
  const criticalFailures=normalizedChecks.filter(item=>item.critical&&item.status==='failed');
  const criticalFindings=safeArray(findings).filter(item=>String(item?.severity||'').toLowerCase()==='critical');
  const unexpectedNetworkErrors=safeArray(networkErrors).filter(item=>item?.expected!==true);
  const http5xx=unexpectedNetworkErrors.filter(item=>Number(item?.status)>=500);
  const requestFailures=unexpectedNetworkErrors.filter(item=>String(item?.type||'').toLowerCase()==='requestfailed'||item?.requestFailed===true);
  const consoleCount=safeArray(consoleErrors).length;
  const uncoveredCritical=Number(coverage?.uncoveredCritical||0);
  const requiredCategories=safeArray(policy.requiredCategories).map(item=>String(item||'').trim().toLowerCase()).filter(Boolean);
  const presentCategories=new Set(normalizedChecks.map(item=>String(item.category||'').trim().toLowerCase()).filter(Boolean));
  const missingCategories=requiredCategories.filter(category=>!presentCategories.has(category));

  const rules={
    failOnCriticalCheck:policy.failOnCriticalCheck!==false,
    failOnCriticalFinding:policy.failOnCriticalFinding!==false,
    maxHttp5xx:Number.isFinite(Number(policy.maxHttp5xx))?Number(policy.maxHttp5xx):0,
    maxRequestFailures:Number.isFinite(Number(policy.maxRequestFailures))?Number(policy.maxRequestFailures):0,
    maxConsoleErrors:Number.isFinite(Number(policy.maxConsoleErrors))?Number(policy.maxConsoleErrors):0,
    maxUncoveredCritical:Number.isFinite(Number(policy.maxUncoveredCritical))?Number(policy.maxUncoveredCritical):0,
    requiredCategories,
  };
  const blockers=[];
  if(rules.failOnCriticalCheck&&criticalFailures.length)blockers.push({type:'critical-check',count:criticalFailures.length,items:criticalFailures.map(item=>item.name)});
  if(rules.failOnCriticalFinding&&criticalFindings.length)blockers.push({type:'critical-finding',count:criticalFindings.length,items:criticalFindings.map(item=>item.name||item.code||'finding')});
  if(http5xx.length>rules.maxHttp5xx)blockers.push({type:'http-5xx',count:http5xx.length,allowed:rules.maxHttp5xx});
  if(requestFailures.length>rules.maxRequestFailures)blockers.push({type:'request-failure',count:requestFailures.length,allowed:rules.maxRequestFailures});
  if(consoleCount>rules.maxConsoleErrors)blockers.push({type:'console-error',count:consoleCount,allowed:rules.maxConsoleErrors});
  if(uncoveredCritical>rules.maxUncoveredCritical)blockers.push({type:'critical-coverage-gap',count:uncoveredCritical,allowed:rules.maxUncoveredCritical});
  if(missingCategories.length)blockers.push({type:'missing-category',count:missingCategories.length,items:missingCategories});

  const passed=blockers.length===0;
  if(override&&(!overrideReason||String(overrideReason).trim().length<3))throw new Error('overrideReason is required when overriding a failed product gate');
  return {
    schemaVersion:1,
    passed,
    allowed:passed||override,
    overridden:!passed&&override,
    overrideReason:override?String(overrideReason).trim():null,
    blockers,
    policy:rules,
    evaluatedAt:new Date().toISOString(),
  };
}

export function buildProductQaSummary({
  systemId,
  profile='release',
  checks=[],
  coverage=null,
  endpoints=[],
  consoleErrors=[],
  networkErrors=[],
  findings=[],
  evidence=[],
  metadata={},
  policy={},
  override=false,
  overrideReason=null,
}={}){
  if(!systemId)throw new TypeError('systemId is required');
  const normalizedChecks=safeArray(checks).map(cleanCheck);
  const counts=normalizedChecks.reduce((acc,item)=>{
    acc.total++;
    if(item.status==='passed')acc.passed++;
    else if(item.status==='failed')acc.failed++;
    else acc.other++;
    return acc;
  },{total:0,passed:0,failed:0,other:0});
  const gate=evaluateProductGate({checks:normalizedChecks,coverage,consoleErrors,networkErrors,findings,policy,override,overrideReason});
  return {
    schemaVersion:2,
    systemId:String(systemId),
    profile:String(profile),
    generatedAt:new Date().toISOString(),
    status:gate.allowed?'PASS':'FAIL',
    counts,
    coverage:coverage||null,
    endpointCount:safeArray(endpoints).length,
    consoleErrorCount:safeArray(consoleErrors).length,
    networkErrorCount:safeArray(networkErrors).length,
    findingCount:safeArray(findings).length,
    evidenceCount:safeArray(evidence).length,
    gate,
    checks:normalizedChecks,
    metadata:metadata&&typeof metadata==='object'?metadata:{},
  };
}

export function renderProductQaText(summary){
  const lines=[
    'ArtiSys QA — Product Summary',
    'System: '+summary.systemId,
    'Profile: '+summary.profile,
    'Status: '+summary.status,
    'Checks: '+summary.counts.passed+'/'+summary.counts.total+' passed; '+summary.counts.failed+' failed',
    'Endpoints: '+summary.endpointCount,
    'Console errors: '+summary.consoleErrorCount,
    'Network errors: '+summary.networkErrorCount,
    'Findings: '+summary.findingCount,
    'Evidence files: '+(summary.evidenceCount??0),
    'Gate: '+(summary.gate.allowed?'ALLOWED':'BLOCKED'),
  ];
  if(summary.coverage){
    lines.push('Coverage: discovered='+(summary.coverage.discovered??'n/a')+' covered='+(summary.coverage.covered??'n/a')+' uncovered='+(summary.coverage.uncovered??'n/a'));
  }
  for(const blocker of summary.gate.blockers||[])lines.push('BLOCKER '+blocker.type+': '+blocker.count);
  return lines.join('\n')+'\n';
}

export function renderProductQaHtml(summary){
  const rows=summary.checks.map(item=>'<tr><td>'+esc(item.name)+'</td><td>'+esc(item.category)+'</td><td>'+esc(item.status)+'</td><td>'+esc(item.critical?'yes':'no')+'</td><td>'+esc(item.error||'')+'</td></tr>').join('');
  const blockers=(summary.gate.blockers||[]).map(item=>'<li>'+esc(item.type)+' ('+esc(item.count)+')</li>').join('');
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ArtiSys QA Product Report</title><style>body{font-family:system-ui,sans-serif;margin:32px;max-width:1100px}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}.pass{color:green}.fail{color:#b00020}code{background:#f4f4f4;padding:2px 5px}</style></head><body><h1>ArtiSys QA Product Report</h1><p><strong>'+esc(summary.systemId)+'</strong> · '+esc(summary.profile)+' · <span class="'+(summary.status==='PASS'?'pass':'fail')+'">'+esc(summary.status)+'</span></p><p>'+summary.counts.passed+'/'+summary.counts.total+' checks passed · '+summary.consoleErrorCount+' console errors · '+summary.networkErrorCount+' network errors</p>'+(blockers?'<h2>Release blockers</h2><ul>'+blockers+'</ul>':'')+'<h2>Checks</h2><table><thead><tr><th>Check</th><th>Category</th><th>Status</th><th>Critical</th><th>Error</th></tr></thead><tbody>'+rows+'</tbody></table></body></html>';
}

export async function writeProductQaBundle({
  outputRoot='qa-delivery-artifacts',
  summary,
  coverage=null,
  endpoints=[],
  consoleErrors=[],
  networkErrors=[],
  findings=[],
  evidence=[],
  runId=null,
  secretValues=[],
}={}){
  if(!summary?.systemId)throw new TypeError('summary.systemId is required');
  const safeSummary=redactSecrets(summary,secretValues);
  const safeCoverage=redactSecrets(coverage||{},secretValues);
  const safeEndpoints=redactSecrets(safeArray(endpoints),secretValues);
  const safeConsoleErrors=redactSecrets(safeArray(consoleErrors),secretValues);
  const safeNetworkErrors=redactSecrets(safeArray(networkErrors),secretValues);
  const safeFindings=redactSecrets(safeArray(findings),secretValues);
  const safeEvidence=redactSecrets(safeArray(evidence),secretValues);
  const id=runId||new Date().toISOString().replace(/[:.]/g,'-');
  const dir=path.resolve(outputRoot,isoSlug(safeSummary.systemId)+'-'+id);
  await fs.mkdir(dir,{recursive:true});
  const files={
    summaryJson:path.join(dir,'QA-SUMMARY.json'),
    summaryText:path.join(dir,'QA-SUMMARY.txt'),
    html:path.join(dir,'report.html'),
    coverage:path.join(dir,'coverage.json'),
    endpoints:path.join(dir,'endpoints.json'),
    consoleErrors:path.join(dir,'console-errors.json'),
    networkErrors:path.join(dir,'network-errors.json'),
    findings:path.join(dir,'findings.json'),
    evidence:path.join(dir,'evidence.json'),
  };
  await Promise.all([
    fs.writeFile(files.summaryJson,JSON.stringify(safeSummary,null,2)+'\n','utf8'),
    fs.writeFile(files.summaryText,renderProductQaText(safeSummary),'utf8'),
    fs.writeFile(files.html,renderProductQaHtml(safeSummary),'utf8'),
    fs.writeFile(files.coverage,JSON.stringify(safeCoverage,null,2)+'\n','utf8'),
    fs.writeFile(files.endpoints,JSON.stringify(safeEndpoints,null,2)+'\n','utf8'),
    fs.writeFile(files.consoleErrors,JSON.stringify(safeConsoleErrors,null,2)+'\n','utf8'),
    fs.writeFile(files.networkErrors,JSON.stringify(safeNetworkErrors,null,2)+'\n','utf8'),
    fs.writeFile(files.findings,JSON.stringify(safeFindings,null,2)+'\n','utf8'),
    fs.writeFile(files.evidence,JSON.stringify(safeEvidence,null,2)+'\n','utf8'),
  ]);
  return {outputDir:dir,files};
}
