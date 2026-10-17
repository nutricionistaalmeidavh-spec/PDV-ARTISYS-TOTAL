'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MODES = new Set(['local', 'lan-host', 'lan-client', 'own-server']);
const SETUP_INTENTS = new Set(['new-installation']);

function text(value) { return String(value ?? '').trim(); }
function read(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try { const value = JSON.parse(fs.readFileSync(filePath, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
function setupIntent(value) {
  const normalized=text(value);
  return SETUP_INTENTS.has(normalized) ? normalized : null;
}
function normalize(input = {}, { requireTerminalKey = true } = {}) {
  const mode = MODES.has(input.mode) ? input.mode : 'local';
  const port = Number(input.port || 4174);
  const result = {
    selected: input.selected === true,
    setupIntent: setupIntent(input.setupIntent),
    mode,
    host: text(input.host) || '0.0.0.0',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4174,
    serverUrl: text(input.serverUrl).replace(/\/+$/, ''),
    terminalId: text(input.terminalId) || 'PDV-01',
    terminalKey: text(input.terminalKey)
  };
  if (mode === 'lan-client' || mode === 'own-server') {
    if (!result.serverUrl) throw new Error('Informe o endereço do servidor.');
    let parsed;
    try { parsed = new URL(result.serverUrl); } catch { throw new Error('Endereço do servidor inválido.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('O servidor deve usar HTTP ou HTTPS.');
    if (mode === 'own-server' && parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('Servidor próprio remoto deve usar HTTPS.');
    if (requireTerminalKey && !result.terminalKey) throw new Error('Credencial segura deste terminal não está configurada.');
  }
  return result;
}
function loadDataServerConfig(filePath) { return normalize(read(filePath), { requireTerminalKey:false }); }
function persistedConfig(config) {
  return {
    selected:Boolean(config.selected),
    setupIntent:setupIntent(config.setupIntent),
    mode:config.mode,
    host:config.host,
    port:config.port,
    serverUrl:config.serverUrl,
    terminalId:config.terminalId
  };
}
function writePersisted(filePath,config){
  const persisted=persistedConfig(config);
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(persisted, null, 2)}\n`, { encoding:'utf8', mode:0o600 });
  fs.renameSync(temporary, filePath);
  return { ...persisted, terminalKey:'' };
}
function saveDataServerConfig(filePath, input) {
  const config = normalize({ ...input, selected:true, setupIntent:null });
  return writePersisted(filePath,config);
}
function saveDataServerIntent(filePath, intent='new-installation') {
  const normalizedIntent=setupIntent(intent);
  if(!normalizedIntent)throw new Error('Intenção de configuração inválida.');
  const current=normalize({...read(filePath),selected:false,setupIntent:normalizedIntent},{requireTerminalKey:false});
  return writePersisted(filePath,current);
}
function isHostMode(config) { return config.mode === 'lan-host'; }
function isExternalMode(config) { return config.mode === 'lan-client' || config.mode === 'own-server'; }
function publicDataServerConfig(config, terminalKeyConfigured = Boolean(config?.terminalKey)) { return { ...persistedConfig(config || normalize({}, {requireTerminalKey:false})), terminalKeyConfigured:Boolean(terminalKeyConfigured) }; }

module.exports = { MODES, SETUP_INTENTS, normalize, loadDataServerConfig, saveDataServerConfig, saveDataServerIntent, isHostMode, isExternalMode, publicDataServerConfig };
