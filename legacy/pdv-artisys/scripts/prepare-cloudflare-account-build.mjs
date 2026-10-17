import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function run(command,args,{cwd=process.cwd(),env=process.env}={}){
  const result=spawnSync(command,args,{cwd,env,encoding:'utf8',stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`Falha ao executar ${command} ${args.join(' ')}`);
}

function npmCommand(){return process.platform==='win32'?'npm.cmd':'npm';}

export function readWranglerConfig({cwd=process.cwd()}={}){
  const file=path.join(cwd,'wrangler.jsonc');
  if(!fs.existsSync(file))throw new Error('wrangler.jsonc ausente.');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

export function validateWranglerConfig(config){
  if(config?.name!=='pdv-artisys')throw new Error('Worker Cloudflare incorreto: esperado pdv-artisys.');
  if(config?.main!=='cloudflare/account/src/worker.mjs')throw new Error('Entrypoint Cloudflare incorreto.');
  if(config?.compatibility_date!=='2026-10-03')throw new Error('compatibility_date inesperada.');
  if(config?.keep_vars!==true)throw new Error('keep_vars precisa permanecer habilitado.');

  const d1=Array.isArray(config?.d1_databases)?config.d1_databases:[];
  const r2=Array.isArray(config?.r2_buckets)?config.r2_buckets:[];
  if(d1.length!==1||d1[0]?.binding!=='artisys')throw new Error('Binding D1 artisys ausente.');
  if(r2.length!==1||r2[0]?.binding!=='artisysr2')throw new Error('Binding R2 artisysr2 ausente.');
  if('database_id' in d1[0])throw new Error('Nao fixe database_id no repositorio.');
  if('bucket_name' in r2[0])throw new Error('Nao fixe bucket_name no repositorio.');

  return config;
}

export function validateAccountWorker({cwd=process.cwd(),env=process.env,runner=run}={}){
  runner(npmCommand(),['run','test:cloudflare:account'],{cwd,env});
}

export async function main({cwd=process.cwd(),env=process.env}={}){
  validateWranglerConfig(readWranglerConfig({cwd}));
  validateAccountWorker({cwd,env});
  console.log('Cloudflare build validado para o Worker pdv-artisys.');
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(isMain)main().catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
