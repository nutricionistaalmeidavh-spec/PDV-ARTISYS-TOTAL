'use strict';
const { PrintingError, wrapPrintingError } = require('../errors');
const { normalizePrinterProfile } = require('../printer-profile');
const PNG_SIGNATURE=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
function resolveThermalPrinter(thermalPrinter) { return thermalPrinter || require('node-thermal-printer'); }
function logoBuffer(value){
  const source=String(value??'').trim();
  const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
  if(!match)return null;
  try{
    const bytes=Buffer.from(match[1],'base64');
    if(!bytes.length||bytes.length>512*1024||bytes.length<PNG_SIGNATURE.length||!bytes.subarray(0,PNG_SIGNATURE.length).equals(PNG_SIGNATURE))return null;
    return bytes;
  }catch{return null;}
}
function createThermalPrinterDriver({ thermalPrinter, timeoutMs = 5000 } = {}) {
  const upstream=resolveThermalPrinter(thermalPrinter);
  const PrinterClass=upstream?.ThermalPrinter || upstream?.printer;
  const types=upstream?.PrinterTypes || upstream?.types;
  if (typeof PrinterClass !== 'function' || !types) throw new PrintingError('PRINTER_NOT_AVAILABLE','node-thermal-printer indisponivel.');
  function resolveType(printerType) {
    if (printerType === 'epson') return types.EPSON;
    if (printerType === 'star') return types.STAR;
    throw new PrintingError('PRINTER_UNSUPPORTED',`Protocolo termico nao suportado: ${printerType}.`);
  }
  async function print(rendered, rawProfile = {}) {
    const profile=normalizePrinterProfile({ ...rawProfile, mode:'thermal' });
    const input=typeof rendered === 'object' && rendered !== null && !Buffer.isBuffer(rendered) ? rendered : {text:rendered};
    const text=String(input.text ?? '');
    if (!text) throw new PrintingError('PRINTER_RENDER_FAILED','Conteudo de impressao vazio.');
    try {
      const printer=new PrinterClass({ type:resolveType(profile.printerType), width:profile.width, interface:profile.interface, options:{ timeout:Number(timeoutMs) } });
      const logo=logoBuffer(input.logoDataUrl);
      if(logo&&typeof printer.printImageBuffer==='function'){
        if(typeof printer.alignCenter==='function')printer.alignCenter();
        await printer.printImageBuffer(logo);
        if(typeof printer.alignLeft==='function')printer.alignLeft();
      }
      printer.println(text);
      if (profile.openDrawerAfterPrint && typeof printer.openCashDrawer === 'function') printer.openCashDrawer();
      if (profile.cut && typeof printer.cut === 'function') printer.cut();
      const executed=await printer.execute();
      if (executed === false) return { success:false, driver:'thermal', device:profile.interface, failureReason:'Printer execute returned false', printedAt:null };
      return { success:true, driver:'thermal', device:profile.interface, printedAt:new Date().toISOString() };
    } catch (error) { throw wrapPrintingError(error,'PRINTER_WRITE_FAILED'); }
  }
  async function status(rawProfile = {}) {
    const profile=normalizePrinterProfile({ ...rawProfile, mode:'thermal' });
    try {
      const printer=new PrinterClass({ type:resolveType(profile.printerType), width:profile.width, interface:profile.interface, options:{ timeout:Number(timeoutMs) } });
      if (typeof printer.isPrinterConnected !== 'function') return { available:true, mode:'thermal', device:profile.interface };
      return { available:Boolean(await printer.isPrinterConnected()), mode:'thermal', device:profile.interface };
    } catch (error) { return { available:false, mode:'thermal', device:profile.interface, errorCode:wrapPrintingError(error,'PRINTER_NOT_AVAILABLE').code }; }
  }
  return Object.freeze({ print, status });
}
module.exports = { createThermalPrinterDriver, logoBuffer };
