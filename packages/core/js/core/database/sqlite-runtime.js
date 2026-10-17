'use strict';

function isLegacyElectron() {
  const major = Number(String(process.versions?.electron || '').split('.')[0] || 0);
  return major > 0 && major <= 22;
}

function loadDatabaseSync() {
  if (!isLegacyElectron()) {
    try {
      return require('node:sqlite').DatabaseSync;
    } catch (error) {
      if (Number(process.versions?.node?.split('.')[0] || 0) >= 22) throw error;
    }
  }

  let BetterSqlite3;
  try {
    BetterSqlite3 = require('better-sqlite3');
  } catch (error) {
    const wrapped = new Error('Runtime SQLite legacy ausente. Reinstale o ArtiSys PDV Legacy.');
    wrapped.code = 'LEGACY_SQLITE_RUNTIME_MISSING';
    wrapped.cause = error;
    throw wrapped;
  }

  return class LegacyDatabaseSync {
    constructor(filename, options = {}) {
      return new BetterSqlite3(filename, {
        readonly: Boolean(options.readOnly || options.readonly),
        fileMustExist: Boolean(options.fileMustExist)
      });
    }
  };
}

const DatabaseSync = loadDatabaseSync();

module.exports = { DatabaseSync, isLegacyElectron };
