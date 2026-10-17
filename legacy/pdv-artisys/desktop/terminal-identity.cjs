'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {randomUUID:nodeRandomUUID}=require('node:crypto');

function createTerminalIdentityStore({userDataPath,randomUUID=nodeRandomUUID}={}){
  const base=String(userDataPath||'').trim();
  if(!base)throw new TypeError('userDataPath is required.');
  if(typeof randomUUID!=='function')throw new TypeError('randomUUID is required.');
  const filePath=path.join(base,'terminal-identity.json');

  function read(){
    if(!fs.existsSync(filePath))return null;
    try{
      const value=JSON.parse(fs.readFileSync(filePath,'utf8'));
      if(!value||typeof value!=='object')return null;
      const terminalId=String(value.terminalId||'').trim();
      const fingerprint=String(value.fingerprint||'').trim();
      if(!terminalId||!fingerprint)return null;
      return{terminalId,fingerprint,createdAt:String(value.createdAt||'')||null};
    }catch{return null;}
  }

  function getOrCreate(){
    const existing=read();
    if(existing)return existing;
    const id=String(randomUUID()).trim().toLowerCase();
    if(!id)throw new Error('Não foi possível gerar a identidade deste computador.');
    const compact=id.replace(/[^a-z0-9]/g,'').slice(0,8).toUpperCase();
    const value={
      terminalId:`PDV-${compact||'TERMINAL'}`,
      fingerprint:`install-${id}`,
      createdAt:new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
    const temporary=`${filePath}.tmp`;
    fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,{encoding:'utf8',mode:0o600});
    fs.renameSync(temporary,filePath);
    return value;
  }

  function status(){return{configured:Boolean(read()),filePath};}
  return{getOrCreate,status};
}

module.exports={createTerminalIdentityStore};
