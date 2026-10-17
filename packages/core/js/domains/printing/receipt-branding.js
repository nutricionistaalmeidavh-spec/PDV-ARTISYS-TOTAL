'use strict';

const MAX_LOGO_BYTES = 512 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

function cleanLine(value, maxLength) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, maxLength);
}

function normalizeLogoDataUrl(value) {
  const source=String(value ?? '').trim();
  const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
  if(!match)return null;
  let bytes;
  try{bytes=Buffer.from(match[1],'base64');}catch{return null;}
  if(!bytes.length||bytes.length>MAX_LOGO_BYTES||bytes.length<PNG_SIGNATURE.length)return null;
  if(!bytes.subarray(0,PNG_SIGNATURE.length).equals(PNG_SIGNATURE))return null;
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function normalizeReceiptBranding(input={},defaults={}) {
  const name=cleanLine(input.name ?? input.storeName ?? defaults.name ?? defaults.storeName ?? 'ArtiSys',80)||'ArtiSys';
  return Object.freeze({
    name,
    address:cleanLine(input.address ?? input.storeAddress ?? defaults.address ?? defaults.storeAddress ?? '',160),
    phone:cleanLine(input.phone ?? input.storePhone ?? defaults.phone ?? defaults.storePhone ?? '',60),
    logoDataUrl:normalizeLogoDataUrl(input.logoDataUrl ?? defaults.logoDataUrl ?? null)
  });
}

function resolveReceiptBranding({settings=null,defaults={}}={}) {
  const get=(key,fallback)=>settings&&typeof settings.get==='function'
    ? settings.get(key,{scope:'global',defaultValue:fallback})
    : fallback;
  return normalizeReceiptBranding({
    name:get('store.name',defaults.name ?? defaults.storeName),
    address:get('store.address',defaults.address ?? defaults.storeAddress),
    phone:get('store.phone',defaults.phone ?? defaults.storePhone),
    logoDataUrl:get('store.logoDataUrl',defaults.logoDataUrl)
  },defaults);
}

module.exports={MAX_LOGO_BYTES,normalizeLogoDataUrl,normalizeReceiptBranding,resolveReceiptBranding};
