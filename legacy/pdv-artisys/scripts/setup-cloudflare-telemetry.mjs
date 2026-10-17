import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function defaultRunner(command,args,{cwd=process.cwd()}={}){
  const actual=process.platform==='win32'&&command==='npx'?'npx.cmd':command;
  const result=spawnSync(actual,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(result.error)throw result.error;
  if(result.status!==0){const error=new Error(String(result.stderr||result.stdout||`Falha ao executar ${command}.`).trim());error.status=result.status;throw error;}
  return{stdout:String(result.stdout||''),stderr:String(result.stderr||''),status:result.status};
}
function stripJsonc(text){return String(text).replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').replace(/,\s*([}\]])/g,'$1');}
function readConfig(configPath){return JSON.parse(stripJsonc(fs.readFileSync(configPath,'utf8')));}
function patchD1DatabaseId(configPath,databaseName,databaseId){let text=fs.readFileSync(configPath,'utf8');const escaped=databaseName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp(`("database_name"\\s*:\\s*"${escaped}"[\\s\\S]*?"database_id"\\s*:\\s*")[^"]*(")`);if(re.test(text))text=text.replace(re,`$1${databaseId}$2`);else{const parsed=JSON.parse(stripJsonc(text));const entry=(parsed.d1_databases||[]).find(item=>item.database_name===databaseName||item.binding==='DB');if(!entry)throw new Error('Binding D1 DB nao encontrado em wrangler.jsonc.');entry.database_id=databaseId;text=`${JSON.stringify(parsed,null,2)}\n`;}fs.writeFileSync(configPath,text);return text;}
function parseD1List(stdout,databaseName){let rows;try{rows=JSON.parse(String(stdout||'[]'));}catch{throw new Error('Nao foi possivel interpretar `wrangler d1 list --json`.');}if(!Array.isArray(rows))rows=Array.isArray(rows?.result)?rows.result:Array.isArray(rows?.databases)?rows.databases:[];const matches=rows.filter(item=>item?.name===databaseName||item?.database_name===databaseName);if(matches.length>1)throw new Error(`Encontrado mais de um D1 chamado ${databaseName}; descoberta ambigua.`);return matches[0]||null;}
function d1Id(row){return String(row?.uuid||row?.id||row?.database_id||'').trim();}
function deploymentUrl(output){const matches=String(output||'').match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev\/?/g)||[];return matches.at(-1)?.replace(/\/$/,'')||'';}
async function provisionTelemetry({cwd=process.cwd(),configPath=path.join(cwd,'cloudflare','telemetry','wrangler.jsonc'),databaseName='artisys-telemetry',runner=defaultRunner,fetchImpl=globalThis.fetch,log=console.log,isInteractive=Boolean(process.stdin.isTTY&&process.stdout.isTTY)}={}){
  if(!fs.existsSync(configPath))throw new Error(`wrangler.jsonc nao encontrado: ${configPath}`);if(typeof fetchImpl!=='function')throw new Error('Fetch indisponivel para validar /health.');
  const cloudflareDir=path.dirname(configPath);const run=(args)=>runner('npx',args,{cwd:cloudflareDir});
  try{await run(['wrangler','whoami','--config',configPath]);}
  catch(error){
    if(!isInteractive)throw new Error(`Cloudflare nao autenticada. Em CI defina CLOUDFLARE_API_TOKEN; em terminal execute npx wrangler login. Detalhe: ${error?.message||error}`);
    log('Cloudflare ainda nao autenticada; abrindo login do Wrangler...');await run(['wrangler','login','--config',configPath]);await run(['wrangler','whoami','--config',configPath]);
  }
  let listing=await run(['wrangler','d1','list','--json','--config',configPath]);let database=parseD1List(listing.stdout,databaseName);
  if(!database){log(`Criando D1 ${databaseName}...`);await run(['wrangler','d1','create',databaseName,'--binding','DB','--config',configPath]);listing=await run(['wrangler','d1','list','--json','--config',configPath]);database=parseD1List(listing.stdout,databaseName);if(!database)throw new Error(`D1 ${databaseName} nao apareceu apos a criacao.`);}
  const databaseId=d1Id(database);if(!databaseId)throw new Error(`D1 ${databaseName} nao retornou um identificador.`);patchD1DatabaseId(configPath,databaseName,databaseId);
  const config=readConfig(configPath);const dbBinding=(config.d1_databases||[]).find(item=>item.binding==='DB');if(!dbBinding)throw new Error('Binding D1 DB nao configurado em wrangler.jsonc.');const analytics=(config.analytics_engine_datasets||[]).find(item=>item.binding==='ANALYTICS');if(!analytics?.dataset)throw new Error('Binding ANALYTICS nao configurado em wrangler.jsonc.');
  log('Aplicando migrations D1 remotas...');await run(['wrangler','d1','migrations','apply','DB','--remote','--config',configPath]);
  log('Publicando Worker...');const deployed=await run(['wrangler','deploy','--config',configPath]);const workerUrl=deploymentUrl(`${deployed.stdout}\n${deployed.stderr}`);if(!workerUrl)throw new Error('Deploy concluido sem URL workers.dev detectavel. Configure workers.dev para o Worker e execute novamente.');
  const health=await fetchImpl(`${workerUrl}/health`,{headers:{accept:'application/json'}});if(!health?.ok)throw new Error(`Health check do Worker falhou com HTTP ${health?.status||0}.`);let healthBody=null;try{healthBody=await health.json();}catch{}if(healthBody&&healthBody.ok!==true)throw new Error('Health check do Worker retornou payload invalido.');
  log(`Worker: ${workerUrl}`);log(`D1: ${databaseName} (${databaseId})`);log(`Analytics Engine: ${analytics.dataset} [binding ${analytics.binding}]`);log(`Configure o build/host ArtiSys com PDV_TELEMETRY_ENDPOINT=${workerUrl}`);
  return{workerUrl,databaseName,databaseId,analyticsBinding:analytics.binding,analyticsDataset:analytics.dataset,configPath};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){provisionTelemetry().catch(error=>{console.error(`Falha ao provisionar telemetria Cloudflare: ${error?.message||error}`);process.exitCode=1;});}
export{defaultRunner,stripJsonc,readConfig,patchD1DatabaseId,parseD1List,deploymentUrl,provisionTelemetry};
