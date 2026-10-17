'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createTerminalCredentialStore({ app, safeStorage } = {}) {
  if (!app || typeof app.getPath !== 'function') throw new TypeError('Electron app is required.');
  if (!safeStorage) throw new TypeError('Electron safeStorage is required.');

  const credentialPath = path.join(app.getPath('userData'), 'terminal-credential.bin');

  function encryptionAvailable() {
    try { return Boolean(safeStorage.isEncryptionAvailable()); }
    catch { return false; }
  }

  function save(secret) {
    const value = String(secret || '').trim();
    if (!value) throw new Error('Credencial do terminal obrigatoria.');
    if (!encryptionAvailable()) throw new Error('Armazenamento seguro do sistema operacional indisponivel.');
    const encrypted = safeStorage.encryptString(value);
    fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
    const temp = `${credentialPath}.tmp`;
    fs.writeFileSync(temp, encrypted, { mode: 0o600 });
    fs.renameSync(temp, credentialPath);
    return { configured: true };
  }

  function load() {
    if (!fs.existsSync(credentialPath)) return null;
    if (!encryptionAvailable()) throw new Error('Armazenamento seguro do sistema operacional indisponivel.');
    const encrypted = fs.readFileSync(credentialPath);
    const value = safeStorage.decryptString(encrypted);
    return String(value || '').trim() || null;
  }

  function remove() {
    try { fs.rmSync(credentialPath, { force: true }); }
    catch { /* best effort */ }
    return { configured: false };
  }

  function status() {
    return { configured: fs.existsSync(credentialPath), encryptionAvailable: encryptionAvailable() };
  }

  return { save, load, remove, status };
}

module.exports = { createTerminalCredentialStore };
