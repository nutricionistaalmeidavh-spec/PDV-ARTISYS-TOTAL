'use strict';

const VALID_PAPER_MM = new Set([58,80]);
const VALID_COLUMNS = new Set([32,42,48]);
const VALID_COLUMNS_MODE = new Set(['auto','manual']);

function columnsForPaper(value) {
  const paperMm=Number(value);
  if (!VALID_PAPER_MM.has(paperMm)) throw new Error('Papel de impressao deve ser 58 ou 80 mm.');
  return paperMm===58 ? 32 : 48;
}

function suggestPaperForPrinter(deviceName) {
  const normalized=String(deviceName || '').trim().toUpperCase().replace(/\s+/g,' ');
  if (!normalized) return null;
  if (/\bPOS\s*80\b/.test(normalized) || /SMX[-\s]?T80E/.test(normalized) || /\b80\s*MM\b/.test(normalized)) return 80;
  if (/\bPOS\s*58\b/.test(normalized) || /\b58\s*MM\b/.test(normalized)) return 58;
  return null;
}

function readBoolean(value,fallback=false) {
  if (value==null || value==='') return Boolean(fallback);
  if (typeof value==='boolean') return value;
  const normalized=String(value).trim().toLowerCase();
  if (['true','1','yes','sim','on'].includes(normalized)) return true;
  if (['false','0','no','nao','não','off'].includes(normalized)) return false;
  return Boolean(fallback);
}

function setting(settings,key,defaultValue) {
  if (!settings || typeof settings.get!=='function') return defaultValue;
  return settings.get(key,{scope:'global',defaultValue});
}

function validatePrintingPreferences(input={}) {
  const deviceName=String(input.deviceName ?? '').trim();
  if (deviceName.length>255) throw new Error('Nome da impressora invalido.');

  let paperMm=Number(input.paperMm ?? 80);
  if (!VALID_PAPER_MM.has(paperMm)) throw new Error('Papel de impressao deve ser 58 ou 80 mm.');

  let columnsMode=String(input.columnsMode ?? 'auto').trim().toLowerCase();
  if (!VALID_COLUMNS_MODE.has(columnsMode)) throw new Error('Modo de colunas deve ser auto ou manual.');

  const requestedColumns=Number(input.columns ?? columnsForPaper(paperMm));
  if (!VALID_COLUMNS.has(requestedColumns)) throw new Error('Largura de impressao deve ser 32, 42 ou 48 colunas.');

  const suggestedPaper=suggestPaperForPrinter(deviceName);
  const legacyNarrowMismatch=suggestedPaper===80 && paperMm===58 && requestedColumns===32;
  if (legacyNarrowMismatch) {
    paperMm=80;
    columnsMode='auto';
  }
  const columns=columnsMode==='auto' ? columnsForPaper(paperMm) : requestedColumns;

  return Object.freeze({
    deviceName,
    paperMm,
    columns,
    columnsMode,
    autoPrint:readBoolean(input.autoPrint,false),
    showSystemDialog:readBoolean(input.showSystemDialog,true),
    cut:readBoolean(input.cut,true),
    openDrawerAfterPrint:readBoolean(input.openDrawerAfterPrint,false)
  });
}

function resolvePrintingPreferences({settings=null,env=process.env,isExistingInstall=true}={}) {
  const rawLegacyWidth=Number(env?.PDV_RECEIPT_WIDTH);
  const legacyWidth=VALID_COLUMNS.has(rawLegacyWidth) ? rawLegacyWidth : 42;
  const legacyPaper=legacyWidth===32 ? 58 : 80;
  const hasLegacyWidth=env?.PDV_RECEIPT_WIDTH!=null && String(env.PDV_RECEIPT_WIDTH).trim()!=='';
  const defaultColumnsMode=hasLegacyWidth || isExistingInstall ? 'manual' : 'auto';
  const defaultAutoPrint=env?.PDV_AUTO_PRINT==null || env.PDV_AUTO_PRINT===''
    ? Boolean(isExistingInstall)
    : readBoolean(env.PDV_AUTO_PRINT,Boolean(isExistingInstall));

  return validatePrintingPreferences({
    deviceName:setting(settings,'printing.deviceName',String(env?.PDV_PRINTER_NAME || '').trim()),
    paperMm:setting(settings,'printing.paperMm',legacyPaper),
    columnsMode:setting(settings,'printing.columnsMode',defaultColumnsMode),
    columns:setting(settings,'printing.columns',legacyWidth),
    autoPrint:setting(settings,'printing.autoPrint',defaultAutoPrint),
    showSystemDialog:setting(settings,'printing.showSystemDialog',!readBoolean(env?.PDV_PRINT_SILENT,false)),
    cut:setting(settings,'printing.cut',readBoolean(env?.PDV_PRINTER_CUT,true)),
    openDrawerAfterPrint:setting(settings,'printing.openDrawerAfterPrint',readBoolean(env?.PDV_PRINTER_OPEN_DRAWER,false))
  });
}

module.exports={columnsForPaper,suggestPaperForPrinter,resolvePrintingPreferences,validatePrintingPreferences,readBoolean,VALID_PAPER_MM,VALID_COLUMNS,VALID_COLUMNS_MODE};
