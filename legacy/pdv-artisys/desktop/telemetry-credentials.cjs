'use strict';
const fs=require('node:fs');const path=require('node:path');
function createTelemetryCredentialStore({app,safeStorage}={}){
 if(!app?.getPath)throw new TypeError('Electron app is required.');if(!safeStorage)throw new TypeError('Electron safeStorage is required.');const filePath=path.join(app.getPath('userData'),'telemetry-credential.bin');
 function encryptionAvailable(){try{return Boolean(safeStorage.isEncryptionAvailable());}catch{return false;}}
 function save(secret){const value=String(secret||'').trim();if(!value)throw new Error('Credencial de telemetria obrigatoria.');if(!encryptionAvailable())throw new Error('Armazenamento seguro do sistema operacional indisponivel.');const bytes=safeStorage.encryptString(value);fs.mkdirSync(path.dirname(filePath),{recursive:true});const temp=`${filePath}.tmp`;fs.writeFileSync(temp,bytes,{mode:0o600});fs.renameSync(temp,filePath);return{configured:true};}
 function load(){if(!fs.existsSync(filePath))return null;if(!encryptionAvailable())return null;try{return String(safeStorage.decryptString(fs.readFileSync(filePath))||'').trim()||null;}catch{return null;}}
 function remove(){try{fs.rmSync(filePath,{force:true});}catch{}return{configured:false};}
 function status(){return{configured:fs.existsSync(filePath),encryptionAvailable:encryptionAvailable()};}
 return{save,load,remove,status};
}
module.exports={createTelemetryCredentialStore};
