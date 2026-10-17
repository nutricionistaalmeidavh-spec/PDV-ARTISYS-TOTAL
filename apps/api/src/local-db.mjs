import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openLocalDatabase(filename=':memory:') {
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  return {
    prepare(sql) {
      const prepared=db.prepare(sql);
      return {
        bind(...params) {
          return {
            first:async()=>prepared.get(...params)||null,
            all:async()=>({results:prepared.all(...params)}),
            run:async()=>({meta:prepared.run(...params)})
          };
        }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const results=[];
        for(const statement of statements)results.push(await statement.run());
        db.exec('COMMIT');
        return results;
      } catch(error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    exec:sql=>db.exec(sql),
    close:()=>db.close()
  };
}
