'use strict';

const { DatabaseSync } = require('./sqlite-runtime');

let savepointSequence = 0;
const managedTransactions = new WeakSet();

function openDatabase(filename) {
  if (!filename) throw new TypeError('Database filename is required.');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (filename !== ':memory:') {
    try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* read-only/unusual FS */ }
    try { db.exec('PRAGMA synchronous = NORMAL'); } catch { /* best effort */ }
  }
  return db;
}

function withTransaction(db, fn) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('Database is required.');
  if (typeof fn !== 'function') throw new TypeError('Transaction callback is required.');

  // DatabaseSync.isTransaction only exists from Node 22.16 onward. Track
  // transactions started by this helper as a compatibility fallback so the
  // project's declared Node >=22 support still handles nested service calls.
  const nested = managedTransactions.has(db) || Boolean(db.isTransaction);
  const savepoint = nested ? `artisys_sp_${++savepointSequence}` : null;
  const ownsTransaction = !nested;

  if (nested) {
    db.exec(`SAVEPOINT ${savepoint}`);
  } else {
    db.exec('BEGIN IMMEDIATE');
    managedTransactions.add(db);
  }

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new TypeError('withTransaction callback must be synchronous with DatabaseSync.');
    }
    if (nested) db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    else db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      if (nested) {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } else {
        db.exec('ROLLBACK');
      }
    } catch { /* preserve original error */ }
    throw error;
  } finally {
    if (ownsTransaction) managedTransactions.delete(db);
  }
}

module.exports = { openDatabase, withTransaction };
