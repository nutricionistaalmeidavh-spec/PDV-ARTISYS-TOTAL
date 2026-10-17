'use strict';

function normalizeBrazilianNationalPhone(value) {
  let digits=String(value ?? '').replace(/\D/g,'');
  if(digits.length>11 && digits.startsWith('55'))digits=digits.slice(2);
  if(!/^\d{10,11}$/.test(digits))throw new Error('Telefone deve ter 10 ou 11 digitos, com DDD e sem o 55.');
  return digits;
}

function normalizeCustomerName(value) {
  return String(value ?? '').replace(/\s+/g,' ').trim().slice(0,80);
}

function buildPickupReadyWhatsappUrl({phone,customerName}={}) {
  const nationalPhone=normalizeBrazilianNationalPhone(phone);
  const name=normalizeCustomerName(customerName);
  const message=name
    ? `Olá, ${name}! Seu pedido está pronto para retirada.`
    : 'Olá! Seu pedido está pronto para retirada.';
  return `https://wa.me/55${nationalPhone}?text=${encodeURIComponent(message)}`;
}

async function openPickupReadyWhatsapp(input={},openExternal=null) {
  const url=buildPickupReadyWhatsappUrl(input);
  if(process.env.ARTISYS_QA==='1' && typeof openExternal!=='function')return {opened:true,url,simulated:true};
  const opener=typeof openExternal==='function'
    ? openExternal
    : async target=>{
      const {shell}=require('electron');
      if(!shell||typeof shell.openExternal!=='function')throw new Error('Abertura externa indisponivel.');
      return shell.openExternal(target);
    };
  await opener(url);
  return {opened:true,url};
}

function registerWhatsappIpc({ipcMain,isTrustedSender=null,openExternal=null}={}) {
  if(!ipcMain||typeof ipcMain.handle!=='function')throw new TypeError('ipcMain e obrigatorio.');
  ipcMain.handle('artisys:external:whatsapp',async(event,input={})=>{
    if(typeof isTrustedSender==='function'&&!isTrustedSender(event))throw new Error('Origem IPC nao autorizada.');
    return openPickupReadyWhatsapp(input,openExternal);
  });
}

module.exports={normalizeBrazilianNationalPhone,buildPickupReadyWhatsappUrl,openPickupReadyWhatsapp,registerWhatsappIpc};
