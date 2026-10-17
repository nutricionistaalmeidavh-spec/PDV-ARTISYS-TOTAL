'use strict';
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
function executableSignature(){try{const stat=fs.statSync(process.execPath);return `${process.execPath}:${stat.mtimeMs}:${stat.size}`;}catch{return process.execPath;}}
const INSTALLATION_FILES=['pdv-artisys.sqlite','pdv-artisys.sqlite-wal','pdv-artisys.sqlite-shm','data-server.json','deployment.json','terminal-credential.bin','terminal-identity.json'];
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}}
function installationState({userData,version,existing=false,signature=executableSignature()}={}) {
  const marker=readJson(path.join(userData,'installation-review.json'));
  return {existing:Boolean(existing),reviewNeeded:Boolean(existing)&&(marker.version!==version||marker.signature!==signature),version};
}
function acknowledgeInstallation({userData,version,signature=executableSignature()}={}) {
  fs.mkdirSync(userData,{recursive:true});const target=path.join(userData,'installation-review.json');
  fs.writeFileSync(`${target}.tmp`,JSON.stringify({version,signature,reviewedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(`${target}.tmp`,target);
}
function archiveInstallation({userData,confirmation,backup,now=()=>new Date().toISOString()}={}) {
  if(confirmation!=='NOVA LOJA')throw new Error('Digite NOVA LOJA para confirmar uma instalação separada.');
  if(!backup?.valid||!backup?.id)throw new Error('É necessário um backup íntegro antes de iniciar uma nova loja.');
  const root=path.resolve(userData);const archive=path.join(root,'installations',`${now().replace(/[:.]/g,'-')}-${randomUUID()}`);
  fs.mkdirSync(archive,{recursive:true});const moved=[];
  try {
    for(const name of INSTALLATION_FILES){const source=path.join(root,name);if(fs.existsSync(source)){fs.renameSync(source,path.join(archive,name));moved.push(name);}}
    fs.writeFileSync(path.join(archive,'manifest.json'),JSON.stringify({archivedAt:now(),safetyBackupId:backup.id,files:moved},null,2),{mode:0o600});
    // Leave hardware and backups intact; no operational record is deleted.
    return {archivePath:archive,safetyBackupId:backup.id};
  } catch(error) {
    for(const name of moved.reverse())fs.renameSync(path.join(archive,name),path.join(root,name));
    throw error;
  }
}
module.exports={installationState,acknowledgeInstallation,archiveInstallation};
