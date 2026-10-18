/** Offline self-hosted SQLite snapshot and staged restore; never overwrites live data. */
import {backup,DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {chmod,mkdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const FORMAT='pdv-total-sqlite-backup-v1';
const REQUIRED_TABLES=['tenants','users','tenant_memberships','auth_sessions'];
async function sha256File(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}
async function exists(path){
  try{await stat(path);return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function absolute(path,label){
  if(typeof path!=='string'||!path.trim()||path===':memory:')throw Error(label+': informe um arquivo SQLite no disco.');
  return resolve(path);
}
function inspect(path){
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    const check=db.prepare('PRAGMA integrity_check').all();
    if(check.length!==1||check[0].integrity_check!=='ok')throw Error('SQLite integrity_check falhou.');
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite foreign_key_check falhou.');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    for(const table of REQUIRED_TABLES)if(!tables.has(table))throw Error('Tabela canônica ausente: '+table);
    return {tableCount:tables.size};
  }finally{db.close();}
}
const manifestPath=path=>path+'.manifest.json';

export async function verifyBackup(backupPath){
  const file=absolute(backupPath,'backup');
  const meta=JSON.parse(await readFile(manifestPath(file),'utf8'));
  if(meta?.format!==FORMAT||!/^[a-f0-9]{64}$/.test(meta.sha256||'')||
    !Number.isSafeInteger(meta.bytes)||meta.bytes<1)throw Error('Manifesto de backup inválido.');
  if((await stat(file)).size!==meta.bytes||await sha256File(file)!==meta.sha256)
    throw Error('Checksum SHA-256 do backup não confere.');
  inspect(file);
  return {file,manifest:meta};
}
export async function createBackup(sourcePath,backupPath){
  const source=absolute(sourcePath,'source'),dest=absolute(backupPath,'backup');
  if(source===dest)throw Error('Origem e destino devem ser diferentes.');
  if(!await exists(source))throw Error('Banco de origem inexistente.');
  if(await exists(dest)||await exists(manifestPath(dest)))
    throw Error('Backup já existe: operação não sobrescreve dados.');
  await mkdir(dirname(dest),{recursive:true,mode:0o700});
  const temp=dest+'.'+randomUUID()+'.tmp';
  const db=new DatabaseSync(source,{readOnly:true});
  try{
    inspect(source);
    await backup(db,temp); // Native SQLite online backup: consistent even with WAL enabled
    await chmod(temp,0o600);
    const bytes=(await stat(temp)).size,sha256=await sha256File(temp);
    inspect(temp);
    const manifest={format:FORMAT,createdAt:new Date().toISOString(),bytes,sha256,
      source:'sqlite',schemaTables:REQUIRED_TABLES};
    await writeFile(manifestPath(dest),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    await rename(temp,dest);
    return {file:dest,manifest};
  }catch(error){
    await rm(temp,{force:true});
    if(!await exists(dest))await rm(manifestPath(dest),{force:true});
    throw error;
  }finally{db.close();}
}
export async function stageRestore(backupPath,targetPath){
  const target=absolute(targetPath,'target');
  const {file,manifest}=await verifyBackup(backupPath);
  if(file===target)throw Error('Destino de restauração não pode ser o próprio backup.');
  if(await exists(target)||await exists(target+'-wal')||await exists(target+'-shm'))
    throw Error('Destino ocupado: restaure em um NOVO caminho com o serviço parado.');
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  const temp=target+'.'+randomUUID()+'.tmp';
  try{
    const db=new DatabaseSync(file,{readOnly:true});
    try{await backup(db,temp);}finally{db.close();}
    await chmod(temp,0o600);
    if(await sha256File(temp)!==manifest.sha256)throw Error('Cópia restaurada não corresponde ao backup.');
    inspect(temp);
    if(await exists(target))throw Error('Destino criado por outro processo durante a restauração.');
    await rename(temp,target);
    return {target,sha256:manifest.sha256};
  }finally{await rm(temp,{force:true});}
}
function usage(){
  throw Error('Uso: node --experimental-sqlite scripts/selfhost-backup.mjs create <banco.sqlite> <backup.sqlite> | verify <backup.sqlite> | restore <backup.sqlite> <novo-banco.sqlite>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [command,...args]=process.argv.slice(2);
  try{
    let result;
    if(command==='create'&&args.length===2)result=await createBackup(...args);
    else if(command==='verify'&&args.length===1)result=await verifyBackup(args[0]);
    else if(command==='restore'&&args.length===2)result=await stageRestore(...args);
    else usage();
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error('[SELFHOST BACKUP] '+error.message);process.exitCode=1;}
}
