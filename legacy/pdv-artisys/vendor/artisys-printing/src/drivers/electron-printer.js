'use strict';
const { wrapPrintingError } = require('../errors');
const { normalizePrinterProfile } = require('../printer-profile');
const MICRONS_PER_PX=25400/96;
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}
function safeLogoDataUrl(value) {
  const source=String(value ?? '').trim();
  if(source.length>699000)return null;
  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/i.test(source)?source:null;
}
function safeDocumentHtml(value){
  const source=String(value??'').trim();
  if(!source||source.length>2*1024*1024)return null;
  if(!/^<!doctype html>|^<html\b/i.test(source))return null;
  if(/<script\b|<iframe\b|<object\b|<embed\b|<link\b|<meta\s+http-equiv\s*=\s*["']?refresh/i.test(source))return null;
  if(/\b(?:src|href)\s*=\s*["']?\s*(?:https?:|file:|javascript:)/i.test(source))return null;
  return source;
}
function thermalPageSize(paperMm,scrollHeightPx){
  const paper=Number(paperMm);
  if(![58,80].includes(paper))return null;
  const pixels=Number(scrollHeightPx);
  const contentPx=Number.isFinite(pixels)&&pixels>0?pixels:480;
  return {width:paper*1000,height:Math.max(50000,Math.ceil(contentPx*MICRONS_PER_PX)+6000)};
}
function createElectronPrinterDriver({ BrowserWindow } = {}) {
  if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow is required.');
  async function print(rendered, rawProfile = {}) {
    const profile=normalizePrinterProfile({ ...rawProfile, mode:'electron' });
    const input=typeof rendered === 'object' && rendered !== null && !Buffer.isBuffer(rendered) ? rendered : { text:rendered };
    const width=Number(input.width || profile.width || 42);
    const a4=String(input.format||'').toUpperCase()==='A4';
    const documentHtml=a4?safeDocumentHtml(input.html):null;
    const text=String(input.text ?? '');
    if (a4 && !documentHtml) throw wrapPrintingError(new Error('HTML A4 invalido ou inseguro.'),'PRINTER_RENDER_FAILED');
    if (!a4 && !text) throw wrapPrintingError(new Error('Conteudo de impressao vazio.'),'PRINTER_RENDER_FAILED');
    const window=new BrowserWindow({ width:a4?794:(width <= 32 ? 320 : 420), height:a4?1123:640, show:false, webPreferences:{ sandbox:true, nodeIntegration:false, contextIsolation:true } });
    try {
      let html=documentHtml;
      if(!a4){
        const safe=escapeHtml(text);
        const logo=safeLogoDataUrl(input.logoDataUrl);
        const maxLogoWidth=width<=32?180:260;
        const fontSize=width<=32?11:12;
        html=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;width:100%;box-sizing:border-box}body{display:flex;justify-content:center}.receipt-sheet{box-sizing:border-box;width:100%;padding:0 3mm}.receipt-logo{display:block;max-width:${maxLogoWidth}px;max-height:150px;width:auto;height:auto;object-fit:contain;margin:0 auto 8px}pre{box-sizing:border-box;width:100%;margin:0;font-family:Consolas,"Courier New",monospace;font-size:${fontSize}px;line-height:1.2;white-space:pre;overflow:hidden}</style></head><body><main class="receipt-sheet">${logo?`<img class="receipt-logo" src="${logo}" alt="">`:''}<pre>${safe}</pre></main></body></html>`;
      }
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      let receiptPageSize=null;
      if(!a4&&[58,80].includes(Number(input.paperMm))){
        let scrollHeight=480;
        if(typeof window.webContents.executeJavaScript==='function'){
          scrollHeight=await window.webContents.executeJavaScript('Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)');
        }
        receiptPageSize=thermalPageSize(input.paperMm,scrollHeight);
      }
      const result=await new Promise(resolve => {
        window.webContents.print({
          silent:profile.silent,
          printBackground:a4,
          deviceName:profile.deviceName || undefined,
          ...(a4?{pageSize:'A4',landscape:false}:receiptPageSize?{pageSize:receiptPageSize,landscape:false}:{})
        }, (success, failureReason) => resolve({ success:Boolean(success), failureReason:failureReason || '' }));
      });
      return { ...result, driver:'electron', device:profile.deviceName, format:a4?'A4':'receipt', printedAt:result.success ? new Date().toISOString() : null };
    } catch (error) { throw wrapPrintingError(error,'PRINTER_WRITE_FAILED'); }
    finally { if (window && typeof window.isDestroyed === 'function' && !window.isDestroyed()) window.close(); }
  }
  async function status() { return { available:true, mode:'electron' }; }
  return Object.freeze({ print, status });
}
module.exports = { createElectronPrinterDriver, escapeHtml, safeLogoDataUrl, safeDocumentHtml, thermalPageSize };