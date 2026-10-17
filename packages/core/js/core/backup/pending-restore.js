'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('../database/sqlite-runtime');
const { createHash } = require('node:crypto');

function sha256(filePath){return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');}
function inspect(filePath){
  let db;
  try{
    db=new DatabaseSync(filePath);
    const row=db.prepare('PRAGMA integrity_check').get();
    const integrity=row?.integrity_check||Object.values(row||{})[0];
    if(integrity!=='ok')throw new Error(`integrity_check=${integrity}`);
    const schemaVersion=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version||0);
    return{schemaVersion};
  }finally{try{db?.close();}catch{}}
}
function listFiles(root){if(!root||!fs.existsSync(root))return[];const files=[];function walk(current){for(const entry of fs.readdirSync(current,{withFileTypes:true})){const absolute=path.join(current,entry.name);if(entry.isDirectory())walk(absolute);else if(entry.isFile())files.push(absolute);else throw new Error('Restore nao aceita links ou arquivos especiais.');}}walk(root);return files.sort();}
function treeDigest(root){const rows=listFiles(root).map(file=>({path:path.relative(root,file).split(path.sep).join('/'),sha256:sha256(file),size:fs.statSync(file).size}));return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
function copyTree(source,target){if(!fs.existsSync(source)||!fs.statSync(source).isDirectory())throw new Error('Componente pendente de restore nao encontrado.');fs.mkdirSync(target,{recursive:true});for(const entry of fs.readdirSync(source,{withFileTypes:true})){const from=path.join(source,entry.name);const to=path.join(target,entry.name);if(entry.isDirectory())copyTree(from,to);else if(entry.isFile()){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}else throw new Error('Restore nao aceita links ou arquivos especiais.');}}
function safeCompanion(marker,companion){const source=path.resolve(String(companion?.sourcePath||''));const target=path.resolve(String(companion?.targetPath||''));if(!source||!target||source===target)throw new Error('Componente de restore invalido.');if(marker.version>=2)throw new Error('Restore V1 nao aceita componentes legados adicionais.');if(!fs.existsSync(source)||!fs.statSync(source).isDirectory())throw new Error(`Componente ${companion.kind||'legado'} ausente.`);if(companion.digest&&treeDigest(source)!==companion.digest)throw new Error(`Checksum do componente ${companion.kind||'legado'} invalido.`);return{...companion,sourcePath:source,targetPath:target};}

function applyPendingRestore({dbPath,backupDir,maxSchemaVersion=Number.MAX_SAFE_INTEGER}={}){
  if(!dbPath||!backupDir)throw new TypeError('dbPath and backupDir are required.');
  const markerPath=path.join(backupDir,'pending-restore.json');
  if(!fs.existsSync(markerPath))return{applied:false,reason:'none'};
  let marker;
  try{marker=JSON.parse(fs.readFileSync(markerPath,'utf8'));}catch(error){throw new Error(`Marcador de restore invalido: ${error.message}`);}
  if(!marker.backupPath||!fs.existsSync(marker.backupPath))throw new Error('Backup pendente nao encontrado.');
  const actual=sha256(marker.backupPath);
  if(actual!==marker.sha256)throw new Error('Checksum do backup pendente invalido.');
  const source=inspect(marker.backupPath);
  if(source.schemaVersion>Number(maxSchemaVersion))throw new Error('Schema do backup e mais novo que o aplicativo instalado.');
  const companions=(Array.isArray(marker.companions)?marker.companions:[]).map(item=>safeCompanion(marker,item));
  const temp=`${dbPath}.restore-new`;
  const rollback=`${dbPath}.restore-rollback`;
  for(const file of [temp,rollback,`${dbPath}-wal`,`${dbPath}-shm`]){try{if(fs.existsSync(file))fs.rmSync(file,{force:true,recursive:true});}catch{}}
  fs.mkdirSync(path.dirname(dbPath),{recursive:true});
  fs.copyFileSync(marker.backupPath,temp);
  const copied=inspect(temp);
  if(copied.schemaVersion!==source.schemaVersion||sha256(temp)!==actual){fs.rmSync(temp,{force:true});throw new Error('Copia temporaria do restore falhou na validacao.');}
  const preparedCompanions=[];
  try{
    for(let index=0;index<companions.length;index+=1){const item=companions[index];const staging=`${item.targetPath}.restore-new-${index}`;const rollbackDir=`${item.targetPath}.restore-rollback-${index}`;for(const dir of [staging,rollbackDir]){if(fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true});}copyTree(item.sourcePath,staging);if(item.digest&&treeDigest(staging)!==item.digest)throw new Error(`Validacao do componente ${item.kind} falhou.`);preparedCompanions.push({...item,staging,rollbackDir,moved:false,installed:false});}
  }catch(error){for(const item of preparedCompanions){try{fs.rmSync(item.staging,{recursive:true,force:true});}catch{}}try{fs.rmSync(temp,{force:true});}catch{}throw error;}
  let movedActive=false;
  try{
    if(fs.existsSync(dbPath)){fs.renameSync(dbPath,rollback);movedActive=true;}
    fs.renameSync(temp,dbPath);
    inspect(dbPath);
    for(const item of preparedCompanions){fs.mkdirSync(path.dirname(item.targetPath),{recursive:true});if(fs.existsSync(item.targetPath)){fs.renameSync(item.targetPath,item.rollbackDir);item.moved=true;}fs.renameSync(item.staging,item.targetPath);item.installed=true;if(item.digest&&treeDigest(item.targetPath)!==item.digest)throw new Error(`Componente ${item.kind} divergiu apos restore.`);}
    fs.rmSync(rollback,{force:true});for(const item of preparedCompanions){if(item.moved)fs.rmSync(item.rollbackDir,{recursive:true,force:true});}
    fs.rmSync(markerPath,{force:true});
    return{applied:true,backupId:marker.backupId,safetyBackupId:marker.safetyBackupId||null,schemaVersion:source.schemaVersion,companionsRestored:preparedCompanions.length};
  }catch(error){
    for(const item of preparedCompanions.slice().reverse()){try{if(item.installed&&fs.existsSync(item.targetPath))fs.rmSync(item.targetPath,{recursive:true,force:true});}catch{}try{if(item.moved&&fs.existsSync(item.rollbackDir))fs.renameSync(item.rollbackDir,item.targetPath);}catch{}try{if(fs.existsSync(item.staging))fs.rmSync(item.staging,{recursive:true,force:true});}catch{}}
    try{if(fs.existsSync(dbPath))fs.rmSync(dbPath,{force:true});}catch{}
    try{if(movedActive&&fs.existsSync(rollback))fs.renameSync(rollback,dbPath);}catch{}
    try{if(fs.existsSync(temp))fs.rmSync(temp,{force:true});}catch{}
    throw error;
  }
}

module.exports={applyPendingRestore,treeDigest};