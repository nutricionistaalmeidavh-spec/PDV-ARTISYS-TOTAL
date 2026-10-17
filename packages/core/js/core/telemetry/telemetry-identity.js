'use strict';
const {randomUUID:cryptoRandomUUID}=require('node:crypto');
function createTelemetryIdentity({db,randomUUID=cryptoRandomUUID}={}){
 if(!db)throw new TypeError('Database is required.');
 db.exec(`CREATE TABLE IF NOT EXISTS telemetry_identity (identity_key TEXT PRIMARY KEY, identity_value TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS telemetry_terminal_identity (terminal_key TEXT PRIMARY KEY, telemetry_terminal_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 function installationId(){let row=db.prepare("SELECT identity_value FROM telemetry_identity WHERE identity_key='installation'").get();if(row)return row.identity_value;const value=String(randomUUID());db.prepare("INSERT OR IGNORE INTO telemetry_identity(identity_key,identity_value) VALUES('installation',?)").run(value);return db.prepare("SELECT identity_value FROM telemetry_identity WHERE identity_key='installation'").get().identity_value;}
 function terminalId(terminalKey='server-terminal'){const local=String(terminalKey||'server-terminal');let row=db.prepare('SELECT telemetry_terminal_id FROM telemetry_terminal_identity WHERE terminal_key=?').get(local);if(row)return row.telemetry_terminal_id;const value=String(randomUUID());db.prepare('INSERT OR IGNORE INTO telemetry_terminal_identity(terminal_key,telemetry_terminal_id) VALUES(?,?)').run(local,value);return db.prepare('SELECT telemetry_terminal_id FROM telemetry_terminal_identity WHERE terminal_key=?').get(local).telemetry_terminal_id;}
 return{installationId,terminalId};
}
module.exports={createTelemetryIdentity};
