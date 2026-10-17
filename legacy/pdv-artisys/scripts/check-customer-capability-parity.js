'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {isKnownPermission}=require('../js/core/auth/permission-registry');

function walk(dir){
  if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const full=path.join(dir,entry.name);
    return entry.isDirectory()?walk(full):[full];
  });
}

function normalize(p){return String(p||'').replace(/\\/g,'/');}

function validateReference({root,capability,layer,reference,errors}){
  if(!reference||!reference.path){errors.push(`${capability.id}: ${layer} reference is missing path`);return false;}
  const absolute=path.join(root,reference.path);
  if(!fs.existsSync(absolute)){errors.push(`${capability.id}: ${layer} path missing: ${reference.path}`);return false;}
  if(reference.marker){
    const content=fs.readFileSync(absolute,'utf8');
    if(!content.includes(reference.marker)){errors.push(`${capability.id}: ${layer} marker missing in ${reference.path}: ${reference.marker}`);return false;}
  }
  return true;
}

function validateRegistry({root=path.resolve(__dirname,'..'),registry,require100=false}={}){
  const errors=[];
  const capabilities=Array.isArray(registry?.capabilities)?registry.capabilities:[];
  if(registry?.schemaVersion!==1)errors.push('registry: schemaVersion must be 1');
  if(!capabilities.length)errors.push('registry: capabilities must not be empty');
  const ids=new Set();
  const referencedBackend=new Set();
  let customerAdmin=0;let surfaceComplete=0;let completeCapabilities=0;

  for(const capability of capabilities){
    if(!capability?.id){errors.push('registry: capability without id');continue;}
    if(ids.has(capability.id))errors.push(`${capability.id}: duplicate capability id`);
    ids.add(capability.id);
    const exposure=capability.exposure;
    if(!['customer','admin','internal'].includes(exposure))errors.push(`${capability.id}: invalid exposure ${exposure}`);
    const supported=capability.status==='supported';
    const layers=['backend','api','client','ui'];
    for(const layer of layers){if(!Array.isArray(capability[layer]))errors.push(`${capability.id}: ${layer} must be an array`);}
    for(const ref of capability.backend||[])referencedBackend.add(normalize(ref.path));
    if(!supported)continue;

    const surface=exposure==='customer'||exposure==='admin';
    if(surface){
      customerAdmin+=1;
      let surfaceOk=true;
      for(const layer of ['backend','api','client','ui']){
        if(!(capability[layer]||[]).length){errors.push(`${capability.id}: supported ${exposure} capability missing ${layer}`);surfaceOk=false;continue;}
        for(const reference of capability[layer])if(!validateReference({root,capability,layer,reference,errors}))surfaceOk=false;
      }
      if(surfaceOk)surfaceComplete+=1;

      if(surfaceOk)completeCapabilities+=1;
    }else{
      for(const reference of capability.backend||[])validateReference({root,capability,layer:'backend',reference,errors});
    }
  }

  const ignored=new Set((registry?.backendIgnore||[]).map(normalize));
  const serviceRoots=['js/core','js/domains'];
  const discovered=serviceRoots.flatMap(relative=>walk(path.join(root,relative)))
    .filter(file=>/-service\.js$/.test(file))
    .map(file=>normalize(path.relative(root,file)));
  for(const backendPath of discovered){
    if(!referencedBackend.has(backendPath)&&!ignored.has(backendPath))errors.push(`backend inventory: ${backendPath} is not mapped to a capability or backendIgnore`);
  }

  const declaredPath=path.join(root,'release','capabilities.json');
  if(fs.existsSync(declaredPath)){
    const declared=JSON.parse(fs.readFileSync(declaredPath,'utf8'));
    const mapped=new Set(capabilities.flatMap(capability=>capability.declaredCapabilities||[]));
    for(const id of declared)if(!mapped.has(id))errors.push(`declared capability not mapped: ${id}`);
  }

  const coveragePercent=customerAdmin===0?100:Number(((completeCapabilities/customerAdmin)*100).toFixed(2));
  if(require100&&coveragePercent!==100)errors.push(`capability coverage: ${coveragePercent}% < 100% (${completeCapabilities}/${customerAdmin} supported customer/admin capabilities complete)`);

  return {ok:errors.length===0,errors,counts:{total:capabilities.length,customerAdmin,surfaceComplete,completeCapabilities,coveragePercent,backendServices:discovered.length}};
}

function validateOperationRegistry({root=path.resolve(__dirname,'..'),registry,capabilityRegistry,require100=false,required=false}={}){
  const errors=[];
  if(!registry){
    if(required)errors.push('operation registry: release/customer-operations.json not found');
    return{ok:errors.length===0,errors,counts:{total:0,surface:0,complete:0,coveragePercent:required?0:100}};
  }
  const operations=Array.isArray(registry.operations)?registry.operations:[];
  if(registry.schemaVersion!==1)errors.push('operation registry: schemaVersion must be 1');
  if(!operations.length)errors.push('operation registry: operations must not be empty');
  const capabilityIds=new Set((capabilityRegistry?.capabilities||[]).map(item=>item.id));
  const ids=new Set();let surface=0;let complete=0;
  for(const operation of operations){
    if(!operation?.id){errors.push('operation registry: operation without id');continue;}
    if(ids.has(operation.id))errors.push(`${operation.id}: duplicate operation id`);
    ids.add(operation.id);
    if(!capabilityIds.has(operation.capabilityId))errors.push(`${operation.id}: unknown capabilityId ${operation.capabilityId}`);
    const exposure=operation.exposure||'customer';
    if(!['customer','admin','internal'].includes(exposure))errors.push(`${operation.id}: invalid exposure ${exposure}`);
    const layers=['backend','api','client','ui','qa'];
    for(const layer of layers)if(!Array.isArray(operation[layer]))errors.push(`${operation.id}: ${layer} must be an array`);
    if(exposure==='internal'){
      if(!(operation.backend||[]).length)errors.push(`${operation.id}: internal operation missing backend`);
      for(const reference of operation.backend||[])validateReference({root,capability:operation,layer:'backend',reference,errors});
      continue;
    }
    const permissions=Array.isArray(operation.permissions)?operation.permissions:[];
    if(!permissions.length)errors.push(`${operation.id}: ${exposure} operation missing permissions`);
    for(const permission of permissions)if(!isKnownPermission(permission))errors.push(`${operation.id}: unknown permission ${permission}`);
    surface+=1;let ok=permissions.length>0&&permissions.every(isKnownPermission);
    for(const layer of layers){
      if(!(operation[layer]||[]).length){errors.push(`${operation.id}: ${exposure} operation missing ${layer}`);ok=false;continue;}
      for(const reference of operation[layer])if(!validateReference({root,capability:operation,layer,reference,errors}))ok=false;
    }
    if(ok)complete+=1;
  }
  const coveragePercent=surface===0?100:Number(((complete/surface)*100).toFixed(2));
  if(require100&&coveragePercent!==100)errors.push(`operation coverage: ${coveragePercent}% < 100% (${complete}/${surface} customer/admin operations complete)`);
  return{ok:errors.length===0,errors,counts:{total:operations.length,surface,complete,coveragePercent}};
}

function parseArgs(argv){
  return {require100:argv.includes('--require-100')};
}

function main(){
  const root=path.resolve(__dirname,'..');
  const registryPath=path.join(root,'release','customer-capabilities.json');
  if(!fs.existsSync(registryPath)){console.error('CAPABILITY PARITY FAIL\nrelease/customer-capabilities.json not found');process.exitCode=1;return;}
  const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
  const operationPath=path.join(root,'release','customer-operations.json');
  const operationRegistry=fs.existsSync(operationPath)?JSON.parse(fs.readFileSync(operationPath,'utf8')):null;
  const options=parseArgs(process.argv.slice(2));
  const result=validateRegistry({root,registry,...options});
  const operationResult=validateOperationRegistry({root,registry:operationRegistry,capabilityRegistry:registry,require100:options.require100,required:options.require100});
  const c=result.counts;const o=operationResult.counts;
  console.log(`CAPABILITY PARITY\nregistry=${c.total} customer/admin=${c.customerAdmin} surface=${c.surfaceComplete}/${c.customerAdmin} complete=${c.completeCapabilities}/${c.customerAdmin} coverage=${c.coveragePercent}% backend-services=${c.backendServices}`);
  console.log(`OPERATION PARITY\nregistry=${o.total} customer/admin=${o.surface} complete=${o.complete}/${o.surface} coverage=${o.coveragePercent}%`);
  const errors=[...result.errors,...operationResult.errors];
  if(errors.length){for(const error of errors)console.error(`- ${error}`);process.exitCode=1;return;}
  console.log('PASS');
}

if(require.main===module)main();
module.exports={validateRegistry,validateOperationRegistry};
