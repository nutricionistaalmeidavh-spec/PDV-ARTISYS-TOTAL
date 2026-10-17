import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveEnvironment, resolveFlow, resolveViewport } from './manifest.js';
import { runQaFlow } from './runner.js';
import { buildModuleContractPlan } from './module-contracts.js';
import { runRendererHealthContract } from './contracts/renderer-health.js';
import { buildProductQaSummary, writeProductQaBundle } from './product-report.js';

const require=createRequire(import.meta.url);
const safeArray=value=>Array.isArray(value)?value:[];

async function readJson(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function defaultTelemetryReader(outputDir){
  if(!outputDir)return[];
  try{return safeArray(await readJson(path.join(outputDir,'telemetry.json')));}
  catch{return[];}
}

function rendererSweepFromTelemetry(events){
  const consoleErrors=[];const pageErrors=[];const requestFailures=[];const httpErrors=[];
  for(const event of safeArray(events)){
    if(event?.type==='console'&&event?.level==='error')consoleErrors.push(event);
    else if(event?.type==='pageerror')pageErrors.push(event);
    else if(event?.type==='requestfailed')requestFailures.push({...event,error:event.failure||event.error||'request failed'});
    else if(event?.type==='http-error')httpErrors.push(event);
  }
  return{consoleErrors,pageErrors,requestFailures,httpErrors,findings:[]};
}

async function loadModuleCoverage({manifest,rootDir}){
  const registryPath=manifest?.crosscut?.moduleRegistry;
  const probePath=manifest?.crosscut?.moduleProbeConfig;
  if(!registryPath||!probePath)return{checks:[],coverage:null};
  const registry=require(path.resolve(rootDir,registryPath));
  const probeConfig=await readJson(path.resolve(rootDir,probePath));
  const plan=buildModuleContractPlan({modules:safeArray(registry?.MODULES),probes:probeConfig?.probes||{}});
  const checks=plan.contracts.map(contract=>{
    const covered=contract.launcher.status==='covered'||contract.protected.status==='covered'||contract.liveSync.status==='covered';
    return{name:contract.id,category:'module-contract',status:covered?'passed':'not-applicable',critical:contract.critical,details:{moduleId:contract.moduleId,launcher:contract.launcher,protected:contract.protected,liveSync:contract.liveSync,dependsOn:contract.dependsOn}};
  });
  return{checks,coverage:plan.coverage};
}

export async function generateCrosscutProfile({
  manifest,rootDir,environment:requestedEnvironment,viewport:requestedViewport,outputRoot='qa-artifacts',
  executeFlow=null,flowRunner=runQaFlow,telemetryReader=defaultTelemetryReader,bundleWriter=writeProductQaBundle,writeArtifacts=false,
}={}){
  if(!manifest?.systemId)throw new TypeError('manifest.systemId is required');
  if(!rootDir)throw new TypeError('rootDir is required');
  const crosscut=manifest.crosscut||{};
  const flowIds=safeArray(crosscut.flows);
  if(!flowIds.length)throw new Error('crosscut flows must contain at least one dedicated flow');
  const criticalFlows=new Set(safeArray(crosscut.criticalFlows).length?crosscut.criticalFlows:flowIds);
  const categories=crosscut.categories&&typeof crosscut.categories==='object'?crosscut.categories:{};
  const {name:environmentName,environment}=resolveEnvironment(manifest,requestedEnvironment);
  const viewport=resolveViewport(manifest,requestedViewport);
  const runs=[];const checks=[];const evidence=[];const telemetry=[];

  const dispatch=executeFlow||(async({flowId})=>{
    const {file:flowFile}=resolveFlow(manifest,flowId,rootDir);
    return flowRunner({manifest,rootDir,environmentName,environment,flowName:flowId,flowFile,viewport,outputRoot});
  });

  for(const flowId of flowIds){
    if(!manifest.flows?.[flowId])throw new Error(`Unknown crosscut flow: ${flowId}`);
    try{
      const result=await dispatch({manifest,rootDir,environmentName,environment,viewport,outputRoot,flowId,flow:manifest.flows[flowId]});
      runs.push({flowId,status:'passed',...result});
      checks.push({name:`flow:${flowId}`,category:categories[flowId]||'crosscut-flow',status:'passed',critical:criticalFlows.has(flowId),durationMs:result?.durationMs??null});
      if(result?.outputDir){evidence.push({type:'qa-flow',flowId,path:result.outputDir});telemetry.push(...safeArray(await telemetryReader(result.outputDir)));}
    }catch(error){
      runs.push({flowId,status:'failed',error:error?.message||String(error),summary:error?.summary||null});
      checks.push({name:`flow:${flowId}`,category:categories[flowId]||'crosscut-flow',status:'failed',critical:criticalFlows.has(flowId),error:error?.message||String(error)});
    }
  }

  const moduleResult=await loadModuleCoverage({manifest,rootDir});
  checks.push(...moduleResult.checks);
  const renderer=await runRendererHealthContract({sweepResult:rendererSweepFromTelemetry(telemetry),policy:crosscut.rendererHealthPolicy||{}});
  checks.push(...safeArray(renderer.checks));
  const findings=safeArray(renderer.findings);const consoleErrors=safeArray(renderer.consoleErrors);const networkErrors=safeArray(renderer.networkErrors);
  const summary=buildProductQaSummary({systemId:manifest.systemId,profile:'crosscut',checks,coverage:moduleResult.coverage,consoleErrors,networkErrors,findings,evidence,policy:crosscut.policy||{},metadata:{flows:flowIds,environment:environmentName,viewport:viewport.name||requestedViewport||manifest.defaultViewport||null}});
  const productGate={profile:'crosscut',checks:summary.checks,...summary.gate};
  let artifacts=null;
  if(writeArtifacts)artifacts=await bundleWriter({outputRoot,summary,coverage:moduleResult.coverage,consoleErrors,networkErrors,findings,evidence});
  return{profile:'crosscut',flowIds,runs,checks,coverage:moduleResult.coverage,renderer,findings,consoleErrors,networkErrors,evidence,summary,productGate,artifacts};
}

export async function runCrosscutProfile(options={}){
  const result=await generateCrosscutProfile({...options,writeArtifacts:true});
  if(!result.productGate.allowed){const error=new Error(`QA crosscut gate failed for ${options.manifest?.systemId||'system'}`);error.crosscut=result;throw error;}
  return result;
}
