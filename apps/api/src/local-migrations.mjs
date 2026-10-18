import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const migrationsDir=resolve(dirname(fileURLToPath(import.meta.url)),'../migrations');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const escapeSql=value=>"'"+String(value).replaceAll("'","''")+"'";

/**
 * Apply the same 0001..NNNN SQL migrations as D1, once, atomically.
 * Reject an untracked existing database rather than replaying destructive ALTERs.
 * The db is the existing, single Node SQLite adapter, not a second database.
 */
export async function applyLocalMigrations(db,{directory=migrationsDir}={}){
  const files=readdirSync(directory).filter(name=>/^\d{4}_[a-z0-9_-]+\.sql$/.test(name)).sort();
  if(!files.length)throw Error('Migrações canônicas não encontradas.');
  for(const [index,name] of files.entries())
    if(Number(name.slice(0,4))!==index+1)
      throw Error('Sequência de migrações incompleta: '+name);
  const existing=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").bind().all()).results.map(x=>x.name);
  if(existing.length&&!existing.includes('schema_migrations'))
    throw Error('Banco SQLite existente sem histórico de migrações: migração assistida obrigatória. Faça backup; não reaplique SQL automaticamente.');
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const previous=(await db.prepare('SELECT name,sha256 FROM schema_migrations ORDER BY name').bind().all()).results;
    const applied=new Map(previous.map(row=>[row.name,row.sha256]));
    for(const row of previous)
      if(!files.includes(row.name))throw Error('Migração aplicada ausente no código: '+row.name);
    let newlyApplied=0;
    for(const name of files){
      const sql=readFileSync(resolve(directory,name),'utf8');
      const digest=sha256(sql);
      if(applied.has(name)){
        if(applied.get(name)!==digest)throw Error('Migração canônica foi alterada: '+name);
        continue;
      }
      db.exec(sql);
      await db.prepare('INSERT INTO schema_migrations(name,sha256,applied_at) VALUES(?,?,?)')
        .bind(name,digest,new Date().toISOString()).run();
      newlyApplied++;
    }
    db.exec('COMMIT');
    return {total:files.length,applied:newlyApplied};
  }catch(error){
    db.exec('ROLLBACK');
    throw error;
  }
}
