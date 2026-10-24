import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {resolve} from 'node:path';
import {validateOfflineProfile,writeOfflineProfile} from './offline-profile.mjs';
const prompt=createInterface({input:stdin,output:stdout});
async function answer(label,defaultValue=''){
 const value=(await prompt.question(label+(defaultValue?' ['+defaultValue+']':'')+': ')).trim();
 return value||defaultValue;
}
async function hiddenToken(){
 if(process.env.PDV_SETUP_GATEWAY_TOKEN)return process.env.PDV_SETUP_GATEWAY_TOKEN;
 if(!stdin.isTTY||!stdin.setRawMode)throw Error('Defina PDV_SETUP_GATEWAY_TOKEN no ambiente para configuração não interativa.');
 stdout.write('Token do gateway (oculto): ');
 prompt.pause();stdin.setRawMode(true);
 let value='';
 try{
  for await(const chunk of stdin){
   for(const char of String(chunk)){
    if(char==='\r'||char==='\n'){stdout.write('\n');return value;}
    if(char==='\u0003')throw Error('Configuração cancelada.');
    if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue;}
    if(/^[a-f0-9]$/.test(char))value+=char;
   }
  }
 }finally{stdin.setRawMode(false);stdin.pause();}
 return value;
}
const settings={};
try{
 stdout.write('PDV TOTAL — configuração segura do PC offline\nO PC precisa estar ligado e na mesma rede Wi-Fi dos garçons.\n');
 settings.cloudOrigin=await answer('Endereço Cloudflare do PDV');
 settings.localOrigin=await answer('Endereço HTTPS local (certificado confiável)', 'https://pdv.loja.lan:8443');
 settings.tenantId=await answer('ID da empresa');
 settings.branchId=await answer('ID da filial');
 settings.gatewayId=await answer('ID do gateway criado pelo proprietário');
 settings.certPath=await answer('Caminho do certificado HTTPS');
 settings.keyPath=await answer('Caminho da chave privada HTTPS');
 settings.dataPath=await answer('Arquivo SQLite do PC',resolve('apps/api/.local/pdv-offline.sqlite'));
 prompt.close();
 settings.token=await hiddenToken();
 const profile=validateOfflineProfile(settings);
 const file=writeOfflineProfile(resolve('apps/api/.local/offline-profile.json'),profile);
 stdout.write('Perfil criado com segurança: '+file+'\n');
 stdout.write('O caixa manual permanece desativado; ative após configurar a exclusividade da filial.\n');
 stdout.write('Prepare o sistema com npm run build e execute npm run offline:start.\n');
}catch(error){prompt.close();console.error('Não foi possível configurar: '+error.message);process.exitCode=1;}
