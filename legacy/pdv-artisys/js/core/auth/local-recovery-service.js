'use strict';
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const {withTransaction}=require('../database/sqlite-database');
const {writeAudit}=require('../audit-log');
const digest=value=>createHash('sha256').update(String(value)).digest();

function createLocalRecoveryService({db,catalog,now=()=>Date.now()}={}){
  if(!db||!catalog)throw new TypeError('Database and catalog required.');
  db.exec(`CREATE TABLE IF NOT EXISTS local_recovery_keys(user_id TEXT PRIMARY KEY REFERENCES users(id),key_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS local_recovery_attempts(scope TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_start INTEGER NOT NULL);`);
  function limit(scope){
    const timestamp=now();
    const row=db.prepare('SELECT * FROM local_recovery_attempts WHERE scope=?').get(scope);
    if(row&&timestamp-row.window_start<900000&&row.attempts>=5){const error=new Error('Muitas tentativas. Aguarde 15 minutos.');error.statusCode=429;throw error;}
    if(!row||timestamp-row.window_start>=900000)db.prepare('INSERT OR REPLACE INTO local_recovery_attempts VALUES(?,1,?)').run(scope,timestamp);
    else db.prepare('UPDATE local_recovery_attempts SET attempts=attempts+1 WHERE scope=?').run(scope);
  }
  function issue({userId,password}={}){
    const user=catalog.getUser(userId);
    limit(`issue:${userId}`);
    if(!user?.active||!catalog.verifyUserPassword(user.username,password).ok)throw new Error('Confirme sua senha atual para gerar a chave.');
    const key=randomBytes(32).toString('hex');
    withTransaction(db,()=>{
      db.prepare('INSERT OR REPLACE INTO local_recovery_keys VALUES(?,?,?)').run(user.id,digest(key).toString('hex'),now());
      writeAudit(db,{action:'auth.recovery.key.rotated',entity:'user',entityId:user.id,actor:{kind:'human',userId:user.id},context:{method:'local-key'}});
    });
    return {key};
  }
  function recover({username,key,password}={}){
    // A global persisted limit also prevents bypass by changing usernames/IPs.
    limit('recover:installation');
    if(String(password||'').length<10)throw new Error('Senha deve possuir pelo menos 10 caracteres.');
    return withTransaction(db,()=>{
      const user=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username||'').trim().toLowerCase());
      const row=user&&db.prepare('SELECT * FROM local_recovery_keys WHERE user_id=?').get(user.id);
      const expected=row?Buffer.from(row.key_hash,'hex'):Buffer.alloc(32);
      const actual=digest(String(key||'').trim());
      if(!timingSafeEqual(expected,actual)||!row)throw new Error('Usuário ou chave de recuperação inválidos.');
      catalog.upsertUser({id:user.id,username:user.username,name:user.name,profileId:user.profile_id,email:user.email,active:true,password},{kind:'system',id:'system'});
      db.prepare('DELETE FROM local_recovery_keys WHERE user_id=?').run(user.id);
      writeAudit(db,{action:'auth.password.recovered',entity:'user',entityId:user.id,actor:{kind:'system',id:'system'},context:{method:'local-key'}});
      return {userId:user.id};
    });
  }
  return Object.freeze({issue,recover});
}
module.exports={createLocalRecoveryService};
