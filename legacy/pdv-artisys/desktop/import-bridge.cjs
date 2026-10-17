'use strict';
const fs=require('node:fs');
const path=require('node:path');
function createImportPicker({dialog}={}){
  if(!dialog||typeof dialog.showOpenDialog!=='function')throw new TypeError('Electron dialog is required.');
  return async function pickImportFile(parentWindow=null){
    const result=await dialog.showOpenDialog(parentWindow||undefined,{title:'Selecionar arquivo para importação',properties:['openFile'],filters:[{name:'Arquivos suportados',extensions:['csv','xlsx','ofx']}]});
    if(result.canceled||!result.filePaths?.[0])return null;
    const filePath=result.filePaths[0];const extension=path.extname(filePath).slice(1).toLowerCase();if(!['csv','xlsx','ofx'].includes(extension))throw new Error('Formato de arquivo nao suportado.');
    const stat=fs.statSync(filePath);if(!stat.isFile())throw new Error('Arquivo de importacao invalido.');if(stat.size>20*1024*1024)throw new Error('Arquivo de importacao excede 20 MB.');
    const data=fs.readFileSync(filePath);return{name:path.basename(filePath),format:extension,content:['csv','ofx'].includes(extension)?data.toString('utf8'):data.toString('base64'),size:stat.size};
  };
}
function registerImportIpc({ipcMain,dialog,getParentWindow,isTrustedSender=()=>true}={}){if(!ipcMain)throw new TypeError('ipcMain is required.');const picker=createImportPicker({dialog});ipcMain.handle('artisys:imports:pick',async event=>{if(!isTrustedSender(event))throw new Error('Origem IPC nao autorizada.');return picker(typeof getParentWindow==='function'?getParentWindow():null);});}
module.exports={createImportPicker,registerImportIpc};
