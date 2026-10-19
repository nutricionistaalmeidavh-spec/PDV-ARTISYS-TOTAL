/**
 * One-time schema provisioning for a fresh D1, plus later unapplied migrations.
 * Triggered only by the real Cloudflare Workers Builds production build.
 */
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const DB_NAME='pdv-artisys-total';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProductionWorkersBuild(env){
  return env.WORKERS_CI==='1' && env.WORKERS_CI_BRANCH==='main' &&
    Boolean(env.WORKERS_CI_BUILD_UUID) && /^[0-9a-f]{40}$/i.test(env.WORKERS_CI_COMMIT_SHA||'');
}

export function chooseDedicatedDatabase(list){
  if(!Array.isArray(list))throw Error('Cloudflare D1 list returned an invalid response');
  const matches=list.filter(item=>item?.name===DB_NAME);
  if(matches.length===0)throw Error('Dedicated pdv-artisys-total D1 database not found; refusing unrelated databases');
  if(matches.length!==1)throw Error('Expected exactly one dedicated pdv-artisys-total D1 database');
  if(!UUID.test(matches[0].uuid||''))throw Error('Cloudflare D1 database returned no valid uuid');
  return matches[0];
}

export function configForRemoteSchema(config,id){
  if(!UUID.test(id))throw Error('Invalid dedicated D1 uuid');
  if(config?.name!==DB_NAME || config?.d1_databases?.length!==1 ||
    config.d1_databases[0].database_name!==DB_NAME ||
    config.d1_databases[0].binding!=='DB' ||
    config.d1_databases[0].migrations_dir!=='apps/api/migrations')
    throw Error('Invalid dedicated D1 binding or migration folder; aborting');
  return {...config,d1_databases:[{...config.d1_databases[0],database_id:id}]};
}

export function hasCompleteSchema(rows){
  if(!Array.isArray(rows))return false;
  const names=new Set(rows.map(row=>row?.name));
  return ['tenants','users','d1_migrations','r4_table_prepayments','saas_subscriptions','saas_invitations'].every(name=>names.has(name));
}

function jsonFromWrangler(stdout){
  const clean=stdout.trim();
  for(const candidate of [clean,clean.slice(clean.indexOf('\n[')+1),clean.slice(clean.indexOf('\n{')+1)]){
    try{return JSON.parse(candidate);}catch{}
  }
  throw Error('Cannot decode Wrangler JSON result');
}

function wrangler(args){
  const cmd=process.platform==='win32'?'npx.cmd':'npx';
  const result=spawnSync(cmd,['--no-install','wrangler',...args],{
    cwd:root,encoding:'utf8',maxBuffer:10*1024*1024,env:process.env});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Wrangler '+args.slice(0,3).join(' ')+' failed (exit '+result.status+'):\n'+(result.stderr||result.stdout||'').slice(-2500));
  return result.stdout;
}

export function provisionProductionD1(){
  if(!isProductionWorkersBuild(process.env)){
    console.log('PDV Total D1: remote provisioning skipped (not production Cloudflare Workers Build).');
    return;
  }
  const databases=jsonFromWrangler(wrangler(['d1','list','--json']));
  const database=chooseDedicatedDatabase(databases);
  const source=readFileSync(resolve(root,'wrangler.jsonc'),'utf8');
  const config=JSON.parse(source.replace(/^\s*\/\/.*$/gm,''));
  const remoteConfig=configForRemoteSchema(config,database.uuid);
  // An auto-provisioned binding without database_id cannot always be used by
  // the D1 migrations CLI. A temporary config makes the deployment deterministic.
  const temporary=resolve(root,'.wrangler-d1-bootstrap-'+process.pid+'.json');
  writeFileSync(temporary,JSON.stringify(remoteConfig,null,2),{mode:0o600,flag:'wx'});
  try{
    console.log('PDV Total D1: applying pending remote schema migrations before production deployment.');
    wrangler(['d1','migrations','apply',DB_NAME,'--remote','--config',temporary]);
    const verify=jsonFromWrangler(wrangler(['d1','execute',DB_NAME,'--remote','--json',
      '--command',"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tenants','users','d1_migrations','r4_table_prepayments','saas_subscriptions','saas_invitations')",
      '--config',temporary]));
    const rows=Array.isArray(verify)?verify[0]?.results:verify?.results;
    if(!hasCompleteSchema(rows))throw Error('Remote D1 schema verification failed; deployment aborted');
    console.log('PDV Total D1: remote schema ready (0001–0030); next step is secure owner provisioning.');
  }finally{
    unlinkSync(temporary);
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))provisionProductionD1();
