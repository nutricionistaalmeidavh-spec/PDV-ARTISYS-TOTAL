'use strict';

const { randomBytes, randomInt, scryptSync, timingSafeEqual } = require('node:crypto');

function hashSecret(secret, salt) {
  return scryptSync(String(secret), String(salt), 32).toString('hex');
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a), 'hex');
    const right = Buffer.from(String(b), 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  } catch { return false; }
}

function parseVersion(value) {
  const parts = String(value || '0.0.0').split(/[.-]/).slice(0, 3).map(part => Number.parseInt(part, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareVersions(a, b) {
  const left = parseVersion(a); const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function mapTerminal(row) {
  if (!row) return null;
  return {
    terminalId: row.terminal_id,
    name: row.name,
    fingerprint: row.fingerprint,
    status: row.status,
    appVersion: row.app_version,
    lastSeenAt: row.last_seen_at,
    pairedAt: row.paired_at,
    pairedBy: row.paired_by
  };
}

function createTerminalRegistry({
  db,
  now = () => new Date().toISOString(),
  idFactory = prefix => `${prefix}-${randomBytes(8).toString('hex')}`,
  secretFactory = () => randomBytes(32).toString('base64url'),
  codeFactory = () => String(randomInt(0, 1000000)).padStart(6, '0'),
  serverVersion = '1.0.0',
  minimumTerminalVersion = '1.0.0',
  capabilities = ['sales','inventory','cash','returns','printing','fiscal']
} = {}) {
  if (!db) throw new TypeError('Database is required.');

  function createPairingCode({ createdBy, ttlSeconds = 300 } = {}) {
    const ttl = Math.min(Math.max(Number(ttlSeconds) || 300, 30), 1800);
    const code = String(codeFactory()).padStart(6, '0').slice(-6);
    if (!/^\d{6}$/.test(code)) throw new Error('Codigo de pareamento invalido.');
    const salt = randomBytes(16).toString('hex');
    const createdAt = now();
    const expiresAt = new Date(Date.parse(createdAt) + ttl * 1000).toISOString();
    const id = idFactory('pair');
    db.prepare(`INSERT INTO pairing_codes (id,code_hash,code_salt,expires_at,created_by,created_at)
      VALUES (?,?,?,?,?,?)`).run(id, hashSecret(code, salt), salt, expiresAt, createdBy || null, createdAt);
    return { id, code, expiresAt, createdAt };
  }

  function findUsableCode(code) {
    const rows = db.prepare('SELECT * FROM pairing_codes WHERE used_at IS NULL ORDER BY created_at DESC').all();
    const currentMs = Date.parse(now());
    return rows.find(row => Date.parse(row.expires_at) >= currentMs && safeEqualHex(hashSecret(code, row.code_salt), row.code_hash)) || null;
  }

  function pairTerminal({ code, terminalId, name, fingerprint, appVersion = '0.0.0' } = {}) {
    const id = String(terminalId || '').trim();
    const fp = String(fingerprint || '').trim();
    if (!id || !fp) throw new Error('Terminal e fingerprint sao obrigatorios.');
    const pair = findUsableCode(String(code || '').trim());
    if (!pair) throw new Error('Codigo de pareamento invalido, utilizado ou expirado.');
    const existing = db.prepare('SELECT terminal_id FROM terminals WHERE terminal_id=? OR fingerprint=?').get(id, fp);
    if (existing) throw new Error('Terminal ou instalacao ja pareado.');
    const credential = String(secretFactory());
    const salt = randomBytes(16).toString('hex');
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO terminals
        (terminal_id,name,fingerprint,credential_hash,credential_salt,status,app_version,last_seen_at,paired_at,paired_by)
        VALUES (?,?,?,?,?,'ACTIVE',?,?,?,?)`)
        .run(id, String(name || id).trim(), fp, hashSecret(credential, salt), salt, String(appVersion || '0.0.0'), timestamp, timestamp, pair.created_by || null);
      db.prepare('UPDATE pairing_codes SET used_at=?,used_by_terminal_id=? WHERE id=? AND used_at IS NULL').run(timestamp, id, pair.id);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    return { ...mapTerminal(db.prepare('SELECT * FROM terminals WHERE terminal_id=?').get(id)), credential };
  }

  function authenticateTerminal(terminalId, credential) {
    const row = db.prepare('SELECT * FROM terminals WHERE terminal_id=?').get(String(terminalId || ''));
    if (!row || row.status !== 'ACTIVE' || !credential) return { ok: false, reason: row?.status === 'BLOCKED' ? 'blocked' : 'invalid' };
    const candidate = hashSecret(credential, row.credential_salt);
    if (!safeEqualHex(candidate, row.credential_hash)) return { ok: false, reason: 'invalid' };
    const timestamp = now();
    db.prepare('UPDATE terminals SET last_seen_at=? WHERE terminal_id=?').run(timestamp, row.terminal_id);
    return { ok: true, terminal: mapTerminal({ ...row, last_seen_at: timestamp }) };
  }

  function listTerminals() {
    return db.prepare('SELECT * FROM terminals ORDER BY name,terminal_id').all().map(mapTerminal);
  }

  function setTerminalStatus(terminalId, status) {
    const normalized = String(status || '').toUpperCase();
    if (!['ACTIVE','BLOCKED'].includes(normalized)) throw new Error('Status de terminal invalido.');
    const result = db.prepare('UPDATE terminals SET status=? WHERE terminal_id=?').run(normalized, String(terminalId));
    if (!result.changes) throw new Error('Terminal nao encontrado.');
    return mapTerminal(db.prepare('SELECT * FROM terminals WHERE terminal_id=?').get(String(terminalId)));
  }

  function handshake({ terminalId = null, appVersion = '0.0.0' } = {}) {
    const compatible = compareVersions(appVersion, minimumTerminalVersion) >= 0;
    const terminal = terminalId ? mapTerminal(db.prepare('SELECT * FROM terminals WHERE terminal_id=?').get(String(terminalId))) : null;
    return {
      serverVersion,
      minimumTerminalVersion,
      schemaVersion: db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version,
      compatible,
      terminalStatus: terminal?.status || null,
      capabilities: [...capabilities]
    };
  }

  return { createPairingCode, pairTerminal, authenticateTerminal, listTerminals, setTerminalStatus, handshake };
}

module.exports = { createTerminalRegistry, compareVersions };
