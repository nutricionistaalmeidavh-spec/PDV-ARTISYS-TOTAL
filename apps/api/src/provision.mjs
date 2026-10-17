import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {hashPassword} from './password.mjs';
import {openLocalDatabase} from './local-db.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const email=String(process.env.PDV_OWNER_EMAIL||'').trim().toLowerCase();
const ownerName=String(process.env.PDV_OWNER_NAME||'').trim();
const slug=String(process.env.PDV_TENANT_SLUG||'').trim().toLowerCase();
const name=String(process.env.PDV_TENANT_NAME||'').trim();
const password=process.env.PDV_OWNER_PASSWORD||'';
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!ownerName||!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)||!name)
  throw new Error('Informe PDV_OWNER_EMAIL, PDV_OWNER_NAME, PDV_TENANT_SLUG e PDV_TENANT_NAME.');
if(password.length<12||password.length>256)throw new Error('PDV_OWNER_PASSWORD deve ter de 12 a 256 caracteres.');
const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
const tenantId=randomUUID(),userId=randomUUID(),branchId=randomUUID(),createdAt=new Date().toISOString();
const pwHash=await hashPassword(password);
const sql=[
'-- PDV TOTAL: execute uma única vez em um banco novo e isolado. NÃO envie este arquivo ao GitHub.',
`INSERT INTO tenants(id,slug,name,created_at) VALUES(${[tenantId,slug,name,createdAt].map(quote).join(',')});`,
`INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(${[userId,email,ownerName,pwHash,createdAt].map(quote).join(',')});`,
`INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(${[tenantId,userId,'OWNER',createdAt].map(quote).join(',')});`,
`INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(${[branchId,tenantId,'MAIN','Matriz',createdAt].map(quote).join(',')});`
].join('\n')+'\n';
if(process.argv.includes('--local')){
  const localFile=process.env.LOCAL_DB_PATH||resolve(here,'../.local/pdv-total.sqlite');
  const db=openLocalDatabase(localFile);
  try{
    db.exec(readFileSync(resolve(here,'../migrations/0001_identity.sql'),'utf8'));
    db.exec('BEGIN IMMEDIATE;');
    try{db.exec(sql);db.exec('COMMIT;');}
    catch(e){db.exec('ROLLBACK;');throw e;}
  }finally{db.close();}
  console.log('Tenant e owner provisionados no banco local. IDs:',tenantId,userId);
}else{
  const output=resolve(here,'../.local/provision.seed.sql');
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,sql,{encoding:'utf8',mode:0o600,flag:'wx'});
  console.log('SQL de provisionamento gerado em',output);
  console.log('Após aplicar em D1 pelo wrangler, remova o arquivo com segurança. Não versionar.');
}
