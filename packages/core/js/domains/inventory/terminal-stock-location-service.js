'use strict';
const { runEnterpriseDepthMigrations } = require('../../core/database/enterprise-depth-migrations');
const { writeAudit } = require('../../core/audit-log');

function createTerminalStockLocationService({db,now=()=>new Date().toISOString()}={}){
  if(!db) throw new TypeError('Database is required.');
  runEnterpriseDepthMigrations(db,now);
  function normalizeTerminalId(value){const id=String(value||'').trim();if(!id)throw new Error('Terminal obrigatorio.');return id;}
  function normalizeLocationId(value){return String(value||'MAIN').trim()||'MAIN';}
  function requireActiveLocation(value){
    const id=normalizeLocationId(value);
    const row=db.prepare('SELECT id,name,type,active FROM stock_locations WHERE id=? AND active=1').get(id);
    if(!row)throw new Error(`Local de estoque ${id} nao encontrado ou inativo.`);
    return row;
  }
  function getTerminalLocation(terminalId){
    const id=normalizeTerminalId(terminalId);
    const row=db.prepare(`SELECT tsl.terminal_id AS terminalId,sl.id AS locationId,sl.name AS locationName,sl.type AS locationType,sl.active
      FROM terminal_stock_locations tsl JOIN stock_locations sl ON sl.id=tsl.location_id WHERE tsl.terminal_id=?`).get(id);
    return row||null;
  }
  function resolveTerminalLocation(terminalId){
    const binding=getTerminalLocation(terminalId);
    if(binding){
      if(!binding.active)throw new Error(`Local de estoque ${binding.locationId} nao encontrado ou inativo.`);
      return binding;
    }
    const main=requireActiveLocation('MAIN');
    return {terminalId:normalizeTerminalId(terminalId),locationId:main.id,locationName:main.name,locationType:main.type,active:main.active,fallback:true};
  }
  function bindTerminal(terminalId,locationId,actor=null){
    const id=normalizeTerminalId(terminalId);const location=requireActiveLocation(locationId);const timestamp=now();
    db.prepare(`INSERT INTO terminal_stock_locations(terminal_id,location_id,updated_at) VALUES(?,?,?)
      ON CONFLICT(terminal_id) DO UPDATE SET location_id=excluded.location_id,updated_at=excluded.updated_at`).run(id,location.id,timestamp);
    writeAudit(db,{action:'terminal.stock-location-bind',entity:'terminal',entityId:id,actor,context:{locationId:location.id}},now);
    return getTerminalLocation(id);
  }
  function listTerminalBindings(){
    return db.prepare(`SELECT tsl.terminal_id AS terminalId,sl.id AS locationId,sl.name AS locationName,sl.type AS locationType,tsl.updated_at AS updatedAt
      FROM terminal_stock_locations tsl JOIN stock_locations sl ON sl.id=tsl.location_id ORDER BY tsl.terminal_id`).all();
  }
  return {bindTerminal,getTerminalLocation,resolveTerminalLocation,listTerminalBindings};
}
module.exports={createTerminalStockLocationService};
