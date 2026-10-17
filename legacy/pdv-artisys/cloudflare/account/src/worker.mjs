const ACTIVATION_TOKEN_TTL_MS=48*60*60*1000;
const RECOVERY_TTL_MS=15*60*1000;
const RECOVERY_RESEND_MS=60*1000;
const ACTIVATION_MAX_ATTEMPTS=5;
const RECOVERY_MAX_ATTEMPTS=5;
const ADMIN_SESSION_TTL_MS=8*60*60*1000;
const ADMIN_SESSION_COOKIE='__Host-artisys_admin_session';

function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function normalizeEmail(value){const email=String(value||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;}
function normalizeInstallationId(value){const id=String(value||'').trim();return /^[A-Za-z0-9._:-]{8,128}$/.test(id)?id:null;}
function newId(prefix){return `${prefix}-${crypto.randomUUID()}`;}
function randomCode(){const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);return String(bytes[0]%1000000).padStart(6,'0');}
async function digestToken({pepper,email,code}){const data=new TextEncoder().encode(`${pepper}:${email}:${code}`);const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function readBody(request){const text=await request.text();if(text.length>32768)throw Object.assign(new Error('Corpo da requisicao excede o limite permitido.'),{statusCode:413});if(!text)return{};try{return JSON.parse(text);}catch{throw Object.assign(new Error('JSON invalido.'),{statusCode:400});}}
async function runDdl(db,sqlText){for(const sql of String(sqlText||'').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();}
function randomSessionToken(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');}
async function sha256Hex(value){const data=new TextEncoder().encode(String(value));const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function secureEqual(a,b){const [left,right]=await Promise.all([sha256Hex(String(a||'')),sha256Hex(String(b||''))]);let diff=0;for(let i=0;i<left.length;i++)diff|=left.charCodeAt(i)^right.charCodeAt(i);return diff===0&&String(a||'').length===String(b||'').length;}
async function adminSessionDigest(env,token){const secret=String(env.ADMIN_TOKEN||'').trim();if(!secret)return null;return sha256Hex(`${secret}:admin-session:${String(token||'')}`);}
function cookieValue(request,name){const raw=String(request.headers.get('cookie')||'');for(const part of raw.split(';')){const index=part.indexOf('=');if(index<0)continue;const key=part.slice(0,index).trim();if(key===name)return part.slice(index+1).trim();}return '';}
function sessionCookie(token,maxAgeSeconds){const value=token||'';return `${ADMIN_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;}


class D1AccountStore{
  constructor(db){if(!db)throw new Error('D1 DB binding ausente.');this.db=db;this.schemaReady=false;}
  async ensureSchema(){
    if(this.schemaReady)return;
    await runDdl(this.db,`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email_normalized TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED','CANCELLED','EXPIRED')),
      created_at TEXT NOT NULL,
      expires_at TEXT,
      metadata_json TEXT,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );
    CREATE TABLE IF NOT EXISTS activation_tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      license_id TEXT NOT NULL,
      installation_id TEXT NOT NULL,
      token_digest TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id),
      FOREIGN KEY(license_id) REFERENCES licenses(id)
    );
    CREATE TABLE IF NOT EXISTS installations (
      installation_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      license_id TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id),
      FOREIGN KEY(license_id) REFERENCES licenses(id)
    );
    CREATE TABLE IF NOT EXISTS password_recovery_tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email_normalized TEXT NOT NULL,
      installation_id TEXT,
      token_digest TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_digest TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );`);
    const activationColumns=new Set(((await this.db.prepare('PRAGMA table_info(activation_tokens)').all()).results||[]).map(row=>row.name));
    if(!activationColumns.has('attempts'))await this.db.prepare('ALTER TABLE activation_tokens ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0').run();
    const recoveryColumns=new Set(((await this.db.prepare('PRAGMA table_info(password_recovery_tokens)').all()).results||[]).map(row=>row.name));
    if(!recoveryColumns.has('installation_id'))await this.db.prepare('ALTER TABLE password_recovery_tokens ADD COLUMN installation_id TEXT').run();
    await runDdl(this.db,`CREATE INDEX IF NOT EXISTS idx_licenses_account_status ON licenses(account_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_activation_tokens_lookup ON activation_tokens(account_id,token_digest,expires_at,used_at);
    CREATE INDEX IF NOT EXISTS idx_activation_tokens_installation ON activation_tokens(installation_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_activation_tokens_attempts ON activation_tokens(account_id,expires_at,used_at,attempts);
    CREATE INDEX IF NOT EXISTS idx_installations_license ON installations(license_id);
    CREATE INDEX IF NOT EXISTS idx_password_recovery_email_created ON password_recovery_tokens(email_normalized,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_password_recovery_expiry ON password_recovery_tokens(expires_at,used_at);
    CREATE INDEX IF NOT EXISTS idx_password_recovery_installation ON password_recovery_tokens(installation_id,email_normalized,expires_at,used_at);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at,revoked_at);`);
    this.schemaReady=true;
  }
  async findAccount(email){
    const row=await this.db.prepare('SELECT id,email_normalized AS email FROM accounts WHERE email_normalized=? LIMIT 1').bind(email).first();
    return row?{id:row.id,email:row.email}:null;
  }
  async findActiveLicense(email){
    const row=await this.db.prepare(`SELECT l.id,a.id AS account_id,a.email_normalized AS email,l.status,l.expires_at
      FROM licenses l JOIN accounts a ON a.id=l.account_id
      WHERE a.email_normalized=? AND l.status='ACTIVE' AND (l.expires_at IS NULL OR l.expires_at>?)
      ORDER BY l.created_at DESC LIMIT 1`).bind(email,new Date().toISOString()).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,status:row.status,expiresAt:row.expires_at||null}:null;
  }
  async saveActivationToken(token){await this.db.prepare(`INSERT INTO activation_tokens(id,account_id,license_id,installation_id,token_digest,attempts,expires_at,used_at,created_at)
    VALUES(?,?,?,?,?,0,?,NULL,?)`).bind(token.id,token.accountId,token.licenseId,token.installationId,token.tokenDigest,token.expiresAt,token.createdAt).run();}
  async findActivationToken({email,digest,now}){
    const row=await this.db.prepare(`SELECT t.id,t.account_id,t.license_id,t.installation_id,t.token_digest,t.attempts,t.expires_at,t.used_at,a.email_normalized AS email
      FROM activation_tokens t JOIN accounts a ON a.id=t.account_id
      WHERE a.email_normalized=? AND t.token_digest=? AND t.used_at IS NULL AND t.expires_at>? AND t.attempts<?
      ORDER BY t.created_at DESC LIMIT 1`).bind(email,digest,now,ACTIVATION_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,licenseId:row.license_id,installationId:row.installation_id,email:row.email,tokenDigest:row.token_digest,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at}:null;
  }
  async findActivationCandidate({email,now}){
    const row=await this.db.prepare(`SELECT t.id,t.account_id,t.license_id,t.installation_id,t.token_digest,t.attempts,t.expires_at,t.used_at,a.email_normalized AS email
      FROM activation_tokens t JOIN accounts a ON a.id=t.account_id
      WHERE a.email_normalized=? AND t.used_at IS NULL AND t.expires_at>? AND t.attempts<?
      ORDER BY t.created_at DESC LIMIT 1`).bind(email,now,ACTIVATION_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,licenseId:row.license_id,installationId:row.installation_id,email:row.email,tokenDigest:row.token_digest,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at}:null;
  }
  async incrementActivationAttempts(id){await this.db.prepare('UPDATE activation_tokens SET attempts=attempts+1 WHERE id=? AND used_at IS NULL').bind(id).run();}
  async provisionLicense({email,expiresAt=null,codeDigest,codeExpiresAt,createdAt}){
    let account=await this.findAccount(email);
    if(!account){account={id:newId('account'),email};await this.db.prepare('INSERT INTO accounts(id,email_normalized,created_at) VALUES(?,?,?)').bind(account.id,email,createdAt).run();}
    await this.db.prepare("UPDATE licenses SET status='CANCELLED' WHERE account_id=? AND status='ACTIVE'").bind(account.id).run();
    const licenseId=newId('license');
    await this.db.prepare(`INSERT INTO licenses(id,account_id,status,created_at,expires_at,metadata_json) VALUES(?,?,'ACTIVE',?,?,?)`).bind(licenseId,account.id,createdAt,expiresAt,JSON.stringify({source:'admin-panel'})).run();
    await this.saveActivationToken({id:newId('token'),accountId:account.id,licenseId,installationId:'PENDING',tokenDigest:codeDigest,expiresAt:codeExpiresAt,createdAt});
    return {accountId:account.id,licenseId};
  }
  async listLicenses(){return (await this.db.prepare(`SELECT l.id,a.email_normalized AS email,l.status,l.created_at,l.expires_at,i.installation_id,i.activated_at FROM licenses l JOIN accounts a ON a.id=l.account_id LEFT JOIN installations i ON i.license_id=l.id ORDER BY l.created_at DESC LIMIT 200`).all()).results||[];}
  async setLicenseStatus(id,status){await this.db.prepare('UPDATE licenses SET status=? WHERE id=?').bind(status,id).run();}
  async createAdminSession({tokenDigest,createdAt,expiresAt}){await this.db.prepare('INSERT INTO admin_sessions(token_digest,created_at,expires_at,revoked_at) VALUES(?,?,?,NULL)').bind(tokenDigest,createdAt,expiresAt).run();}
  async findAdminSession({digest,now}){const row=await this.db.prepare('SELECT token_digest,expires_at FROM admin_sessions WHERE token_digest=? AND revoked_at IS NULL AND expires_at>? LIMIT 1').bind(digest,now).first();return row?{tokenDigest:row.token_digest,expiresAt:row.expires_at}:null;}
  async deleteAdminSession(digest){await this.db.prepare('DELETE FROM admin_sessions WHERE token_digest=?').bind(digest).run();}
  async createRecoveryForInstallation({installationId,email,codeDigest,createdAt,expiresAt}){
    const row=await this.db.prepare(`SELECT i.account_id,a.email_normalized AS email,l.status,l.expires_at FROM installations i JOIN accounts a ON a.id=i.account_id JOIN licenses l ON l.id=i.license_id WHERE i.installation_id=? LIMIT 1`).bind(installationId).first();
    if(!row||row.email!==email||row.status!=='ACTIVE'||(row.expires_at&&row.expires_at<=createdAt))return null;
    await this.saveRecoveryToken({id:newId('recovery'),accountId:row.account_id,email,installationId,tokenDigest:codeDigest,attempts:0,createdAt,expiresAt});return {accountId:row.account_id};
  }
  async consumeActivationToken(id,usedAt){await this.db.prepare('UPDATE activation_tokens SET used_at=? WHERE id=? AND used_at IS NULL').bind(usedAt,id).run();}
  async saveRecoveryToken(token){
    await this.db.prepare(`INSERT INTO password_recovery_tokens(id,account_id,email_normalized,installation_id,token_digest,attempts,expires_at,used_at,created_at)
      VALUES(?,?,?,?,?,0,?,NULL,?)`).bind(token.id,token.accountId,token.email,token.installationId||null,token.tokenDigest,token.expiresAt,token.createdAt).run();
  }
  async findRecoveryToken({email,installationId,digest,now}){
    const row=await this.db.prepare(`SELECT id,account_id,email_normalized AS email,installation_id,token_digest,attempts,expires_at,used_at,created_at
      FROM password_recovery_tokens WHERE email_normalized=? AND installation_id=? AND token_digest=? AND used_at IS NULL AND expires_at>? AND attempts<?
      ORDER BY created_at DESC LIMIT 1`).bind(email,installationId,digest,now,RECOVERY_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,installationId:row.installation_id,tokenDigest:row.token_digest,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at,createdAt:row.created_at}:null;
  }
  async findRecoveryCandidate({email,installationId,now}){
    const row=await this.db.prepare(`SELECT id,account_id,email_normalized AS email,installation_id,token_digest,attempts,expires_at,used_at,created_at
      FROM password_recovery_tokens WHERE email_normalized=? AND installation_id=? AND used_at IS NULL AND expires_at>? AND attempts<?
      ORDER BY created_at DESC LIMIT 1`).bind(email,installationId,now,RECOVERY_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,installationId:row.installation_id,tokenDigest:row.token_digest,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at,createdAt:row.created_at}:null;
  }
  async findLatestRecoveryToken({email,now}){
    const row=await this.db.prepare(`SELECT id,account_id,email_normalized AS email,attempts,expires_at,used_at,created_at
      FROM password_recovery_tokens WHERE email_normalized=? AND used_at IS NULL AND expires_at>? AND attempts<?
      ORDER BY created_at DESC LIMIT 1`).bind(email,now,RECOVERY_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at,createdAt:row.created_at}:null;
  }
  async consumeRecoveryToken(id,usedAt){await this.db.prepare('UPDATE password_recovery_tokens SET used_at=? WHERE id=? AND used_at IS NULL').bind(usedAt,id).run();}
  async incrementRecoveryAttempts(id){await this.db.prepare('UPDATE password_recovery_tokens SET attempts=attempts+1 WHERE id=? AND used_at IS NULL').bind(id).run();}
  async saveInstallation(record){await this.db.prepare(`INSERT INTO installations(installation_id,account_id,license_id,activated_at,last_seen_at)
    VALUES(?,?,?,?,?) ON CONFLICT(installation_id) DO UPDATE SET account_id=excluded.account_id,license_id=excluded.license_id,last_seen_at=excluded.last_seen_at`).bind(record.installationId,record.accountId,record.licenseId,record.activatedAt,record.activatedAt).run();}
  async findInstallation(id){
    const row=await this.db.prepare(`SELECT i.installation_id,i.license_id,i.activated_at,a.email_normalized AS account_email,l.status,l.expires_at
      FROM installations i JOIN accounts a ON a.id=i.account_id JOIN licenses l ON l.id=i.license_id WHERE i.installation_id=? LIMIT 1`).bind(id).first();
    return row?{installationId:row.installation_id,licenseId:row.license_id,activatedAt:row.activated_at,accountEmail:row.account_email,status:row.status,expiresAt:row.expires_at||null}:null;
  }
  async logEmail(record){await this.db.prepare(`INSERT INTO email_delivery_log(id,account_id,email_normalized,template,status,error,created_at) VALUES(?,?,?,?,?,?,?)`).bind(record.id,record.accountId||null,record.email,record.template,record.status,record.error||null,record.createdAt).run();}
}

function resolveStore(env){return env.ACCOUNT_STORE||new D1AccountStore(env.DB||env.artisys);}
async function readyStore(env){const store=resolveStore(env);if(typeof store.ensureSchema==='function')await store.ensureSchema();return store;}
function activeInstallation(record,now){if(!record)return false;if(record.status&&record.status!=='ACTIVE')return false;if(record.expiresAt&&record.expiresAt<=now)return false;return true;}
function recoveryPepper(env){return String(env.RECOVERY_PEPPER||env.ACTIVATION_PEPPER||'').trim();}

async function requestActivation(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);
  if(!email||!installationId)return json({error:'Dados de ativacao invalidos.'},400);
  return json({accepted:true,message:'Use o codigo de ativacao fornecido pelo administrador ArtiSys.'},202);
}

async function verifyActivation(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);const code=String(body.code||'').trim();
  if(!email||!installationId||!/^\d{6}$/.test(code))return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'Servico de ativacao indisponivel.'},503);
  const store=await readyStore(env);const now=new Date().toISOString();const digest=await digestToken({pepper,email,code});
  const token=typeof store.findActivationCandidate==='function'
    ? await store.findActivationCandidate({email,now})
    : await store.findActivationToken({email,digest,now});
  if(!token)return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  if(token.tokenDigest&&token.tokenDigest!==digest){
    if(typeof store.incrementActivationAttempts==='function')await store.incrementActivationAttempts(token.id);
    return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  }
  if(token.installationId!=='PENDING'&&token.installationId!==installationId){
    if(typeof store.incrementActivationAttempts==='function')await store.incrementActivationAttempts(token.id);
    return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  }
  const license=await store.findActiveLicense(email);if(!license||license.id!==token.licenseId)return json({error:'Licenca indisponivel para ativacao.'},409);
  await store.consumeActivationToken(token.id,now);
  await store.saveInstallation({installationId,accountId:token.accountId||license.accountId||null,licenseId:license.id,accountEmail:email,status:'ACTIVE',activatedAt:now});
  return json({licenseId:license.id,accountEmail:email,activatedAt:now});
}

async function requestPasswordRecovery(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);
  if(!email||!installationId)return json({accepted:true},202);
  const store=await readyStore(env);const record=await store.findInstallation(installationId);const now=new Date().toISOString();
  if(!activeInstallation(record,now)||normalizeEmail(record.accountEmail)!==email)return json({accepted:true},202);
  return json({accepted:true,message:'Solicite o codigo de recuperacao ao administrador ArtiSys.'},202);
}

async function verifyPasswordRecovery(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);const code=String(body.code||'').trim();
  if(!email||!installationId||!/^[0-9]{6}$/.test(code))return json({error:'Codigo de recuperacao invalido ou expirado.'},400);
  const pepper=recoveryPepper(env);if(!pepper)return json({error:'Servico de recuperacao indisponivel.'},503);
  const store=await readyStore(env);const now=new Date().toISOString();const digest=await digestToken({pepper,email,code});
  const token=typeof store.findRecoveryCandidate==='function'
    ? await store.findRecoveryCandidate({email,installationId,now})
    : await store.findRecoveryToken({email,installationId,digest,now});
  if(!token)return json({error:'Codigo de recuperacao invalido ou expirado.'},400);
  if(token.tokenDigest&&token.tokenDigest!==digest){
    if(typeof store.incrementRecoveryAttempts==='function')await store.incrementRecoveryAttempts(token.id);
    return json({error:'Codigo de recuperacao invalido ou expirado.'},400);
  }
  await store.consumeRecoveryToken(token.id,now);
  return json({verified:true,accountEmail:email,installationId});
}


async function createAdminSession(request,env){
  const expected=String(env.ADMIN_TOKEN||'').trim();
  if(!expected)return json({error:'ADMIN_TOKEN ausente.'},503);
  const body=await readBody(request);
  const provided=String(body.token||'');
  if(!provided||!(await secureEqual(provided,expected)))return json({error:'Credencial administrativa invalida.'},401);
  const store=await readyStore(env);
  const token=randomSessionToken();
  const tokenDigest=await adminSessionDigest(env,token);
  const createdAt=new Date().toISOString();
  const expiresAt=new Date(Date.now()+ADMIN_SESSION_TTL_MS).toISOString();
  await store.createAdminSession({tokenDigest,createdAt,expiresAt});
  return new Response(null,{status:204,headers:{
    'cache-control':'no-store',
    'set-cookie':sessionCookie(token,Math.floor(ADMIN_SESSION_TTL_MS/1000))
  }});
}

async function adminSessionAuthorized(request,env){
  const token=cookieValue(request,ADMIN_SESSION_COOKIE);
  if(!token)return false;
  const digest=await adminSessionDigest(env,token);
  if(!digest)return false;
  const store=await readyStore(env);
  return Boolean(await store.findAdminSession({digest,now:new Date().toISOString()}));
}

async function revokeAdminSession(request,env){
  const token=cookieValue(request,ADMIN_SESSION_COOKIE);
  if(token){
    const digest=await adminSessionDigest(env,token);
    if(digest){const store=await readyStore(env);await store.deleteAdminSession(digest);}
  }
  return new Response(null,{status:204,headers:{
    'cache-control':'no-store',
    'set-cookie':sessionCookie('',0)
  }});
}

function loginHtml(){return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar | Central de Licenças ArtiSys</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18181b;background:#f4f5f7}
*{box-sizing:border-box}body{margin:0}.wrap{min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(440px,100%);background:#fff;border:1px solid #dddfe4;border-radius:18px;padding:24px;box-shadow:0 8px 30px rgba(0,0,0,.06)}
h1{margin:0 0 8px;font-size:26px}.sub{margin:0 0 22px;color:#64646f}.field{display:flex;flex-direction:column;gap:7px}label{font-weight:700;font-size:14px}
input,button{font:inherit;border-radius:10px;border:1px solid #c9cbd1;padding:12px}button{cursor:pointer;font-weight:750;background:#18181b;color:#fff;border-color:#18181b;margin-top:12px;width:100%}
.error{min-height:20px;margin-top:12px;color:#b42318;font-size:14px}.hint{font-size:12px;color:#71717a;margin-top:14px}
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <h1>Entrar na Central</h1>
  <p class="sub">Acesso restrito à administração de licenças ArtiSys.</p>
  <div class="field"><label for="token">Senha administrativa</label><input id="token" type="password" autocomplete="current-password" autofocus></div>
  <button id="login" type="button" onclick="login()">Entrar</button>
  <div id="error" class="error"></div>
  <div class="hint">A credencial é usada somente para criar a sessão segura e não fica armazenada nesta página.</div>
</div></div>
<script>
async function login(){
  const input=document.querySelector('#token'),button=document.querySelector('#login'),error=document.querySelector('#error');
  error.textContent='';button.disabled=true;
  try{
    const r=await fetch('/v1/admin/session',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({token:input.value})});
    input.value='';
    if(!r.ok){let j={};try{j=await r.json()}catch{}throw Error(j.error||'Falha ao entrar.');}
    location.reload();
  }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
}
document.querySelector('#token').addEventListener('keydown',event=>{if(event.key==='Enter')login();});
</script>
</body>
</html>`;}

function adminHtml(){return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Central de Licenças ArtiSys</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18181b;background:#f4f5f7}
*{box-sizing:border-box}body{margin:0}.wrap{max-width:1080px;margin:0 auto;padding:28px 16px 48px}.top{display:flex;gap:14px;justify-content:space-between;align-items:flex-start}
h1{margin:0 0 6px;font-size:30px}h2{margin:0 0 14px;font-size:18px}.sub{margin:0 0 22px;color:#64646f}
.card{background:#fff;border:1px solid #dddfe4;border-radius:16px;padding:20px;margin:14px 0;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.field{display:flex;flex-direction:column;gap:6px;min-width:220px;flex:1}
label{font-weight:650;font-size:14px}input,button{font:inherit;border-radius:10px;border:1px solid #c9cbd1;padding:11px 12px}
button{cursor:pointer;font-weight:700;background:#18181b;color:#fff;border-color:#18181b}.secondary{background:#fff;color:#18181b}
.hint{font-size:13px;color:#70707b}.result{margin-top:16px;padding:16px;background:#f7f7f8;border-radius:12px;display:none}
.code{font-size:34px;letter-spacing:7px;font-weight:850;margin:8px 0}.manual{font-weight:700;margin:4px 0}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:700px}td,th{padding:10px;border-bottom:1px solid #ececf0;text-align:left;white-space:nowrap}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#71717a}.muted{color:#71717a}.actions{display:flex;gap:6px;flex-wrap:wrap}.actions button{padding:7px 9px;font-size:12px}
@media(max-width:640px){.wrap{padding:18px 12px}.card{padding:16px}.field{min-width:100%}.code{font-size:30px}.top{align-items:center}.top h1{font-size:25px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div><h1>Central de Licenças ArtiSys</h1><p class="sub">Libere o acesso do cliente manualmente. A Central gera o código e você envia o código ao cliente.</p></div><button type="button" class="secondary" onclick="logout()">Sair</button></div>

  <div class="card">
    <h2>Liberar novo acesso</h2>
    <div class="row">
      <div class="field"><label for="email">E-mail do cliente</label><input id="email" type="email" autocomplete="email" placeholder="cliente@empresa.com"></div>
      <div class="field"><label for="expires">Validade da licença <span class="hint">(opcional)</span></label><input id="expires" type="date"></div>
      <button type="button" onclick="release()">Gerar código</button>
    </div>
    <div id="released" class="result">
      <div class="hint">Código de ativação</div>
      <div id="released-code" class="code"></div>
      <div class="manual">Você envia o código ao cliente.</div>
      <div id="released-expiry" class="hint"></div>
      <p><button type="button" class="secondary" onclick="copyCode()">Copiar código</button></p>
    </div>
  </div>

  <div class="card">
    <h2>Licenças</h2>
    <div id="list" class="muted">Carregando...</div>
  </div>
</div>
<script>
async function api(p,o={}){
  const r=await fetch(p,{...o,credentials:'same-origin',headers:{'content-type':'application/json',...(o.headers||{})}});
  if(r.status===401){location.reload();throw Error('Sessão expirada.');}
  let j={};try{j=await r.json()}catch{}
  if(!r.ok)throw Error(j.error||'Falha');
  return j;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function load(){try{const j=await api('/v1/admin/licenses');document.querySelector('#list').innerHTML='<div class="table-wrap"><table><tr><th>E-mail</th><th>Status</th><th>Validade</th><th>Instalação</th><th>Ações</th></tr>'+j.licenses.map(x=>'<tr><td>'+esc(x.email)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.expires_at||'-')+'</td><td>'+esc(x.installation_id||'-')+'</td><td><div class="actions">'+(x.installation_id?'<button onclick="recovery(decodeURIComponent(\\''+encodeURIComponent(x.installation_id)+'\\'),decodeURIComponent(\\''+encodeURIComponent(x.email)+'\\'))">Recuperação</button>':'')+'<button onclick="status(\\''+encodeURIComponent(x.id)+'\\',\\'SUSPENDED\\')">Suspender</button><button onclick="status(\\''+encodeURIComponent(x.id)+'\\',\\'CANCELLED\\')">Cancelar</button></div></td></tr>').join('')+'</table></div>'}catch(e){alert(e.message)}}
async function release(){try{const email=document.querySelector('#email').value,expiresAt=document.querySelector('#expires').value||null;const j=await api('/v1/admin/licenses',{method:'POST',body:JSON.stringify({email,expiresAt})});document.querySelector('#released-code').textContent=j.code;document.querySelector('#released-expiry').textContent='Código válido até '+j.codeExpiresAt;document.querySelector('#released').style.display='block';await load()}catch(e){alert(e.message)}}
async function copyCode(){const code=document.querySelector('#released-code').textContent.trim();if(!code)return;try{await navigator.clipboard.writeText(code)}catch{const el=document.createElement('textarea');el.value=code;document.body.appendChild(el);el.select();document.execCommand('copy');el.remove()}}
async function recovery(installationId,email){try{const j=await api('/v1/admin/recovery',{method:'POST',body:JSON.stringify({installationId,email})});alert('Código de recuperação: '+j.code+' (15 min). Você envia esse código ao cliente.')}catch(e){alert(e.message)}}
async function status(id,status){try{await api('/v1/admin/licenses/'+decodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status})});await load()}catch(e){alert(e.message)}}
async function logout(){try{await fetch('/v1/admin/session',{method:'DELETE',credentials:'same-origin'});}finally{location.reload();}}
load();
</script>
</body>
</html>`;}

async function adminRoute(request,env,url){
  if(request.method==='POST'&&url.pathname==='/v1/admin/session')return createAdminSession(request,env);
  if(request.method==='DELETE'&&url.pathname==='/v1/admin/session')return revokeAdminSession(request,env);
  if(request.method==='GET'&&url.pathname==='/admin'){
    const authorized=await adminSessionAuthorized(request,env);
    return new Response(authorized?adminHtml():loginHtml(),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }
  if(!url.pathname.startsWith('/v1/admin/'))return null;
  if(!(await adminSessionAuthorized(request,env)))return json({error:'Nao autorizado.'},401);
  const store=await readyStore(env);
  if(request.method==='GET'&&url.pathname==='/v1/admin/licenses')return json({licenses:await store.listLicenses()});
  if(request.method==='POST'&&url.pathname==='/v1/admin/licenses'){
    const body=await readBody(request),email=normalizeEmail(body.email);if(!email)return json({error:'E-mail invalido.'},400);
    const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'ACTIVATION_PEPPER ausente.'},503);
    let expiresAt=null;if(body.expiresAt){const d=new Date(body.expiresAt+'T23:59:59.999Z');if(Number.isNaN(d.getTime()))return json({error:'Validade invalida.'},400);expiresAt=d.toISOString();}
    const code=randomCode(),createdAt=new Date().toISOString(),codeExpiresAt=new Date(Date.parse(createdAt)+ACTIVATION_TOKEN_TTL_MS).toISOString(),codeDigest=await digestToken({pepper,email,code});
    const provisioned=await store.provisionLicense({email,expiresAt,codeDigest,codeExpiresAt,createdAt});return json({...provisioned,email,code,codeExpiresAt,expiresAt},201);
  }
  if(request.method==='PATCH'&&url.pathname.startsWith('/v1/admin/licenses/')){const id=decodeURIComponent(url.pathname.slice('/v1/admin/licenses/'.length));const body=await readBody(request),status=String(body.status||'').toUpperCase();if(!['ACTIVE','SUSPENDED','CANCELLED','EXPIRED'].includes(status))return json({error:'Status invalido.'},400);await store.setLicenseStatus(id,status);return json({updated:true,id,status});}
  if(request.method==='POST'&&url.pathname==='/v1/admin/recovery'){
    const body=await readBody(request),email=normalizeEmail(body.email),installationId=normalizeInstallationId(body.installationId);if(!email||!installationId)return json({error:'E-mail ou instalacao invalidos.'},400);
    const pepper=recoveryPepper(env);if(!pepper)return json({error:'RECOVERY_PEPPER ausente.'},503);
    const code=randomCode(),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+RECOVERY_TTL_MS).toISOString(),codeDigest=await digestToken({pepper,email,code});
    const result=await store.createRecoveryForInstallation({installationId,email,codeDigest,createdAt,expiresAt});if(!result)return json({error:'Instalacao ativa nao encontrada para este e-mail.'},404);return json({email,installationId,code,expiresAt},201);
  }
  return json({error:'Rota administrativa nao encontrada.'},404);
}

async function licenseStatus(url,env){
  const installationId=normalizeInstallationId(url.searchParams.get('installationId'));if(!installationId)return json({error:'Instalacao invalida.'},400);
  const store=await readyStore(env);const record=await store.findInstallation(installationId);const now=new Date().toISOString();
  return json({active:activeInstallation(record,now)});
}

export async function handleRequest(request,env={}){
  const url=new URL(request.url);try{
    const adminResponse=await adminRoute(request,env,url);if(adminResponse)return adminResponse;
    if(request.method==='GET'&&url.pathname==='/health')return json({ok:true,service:'artisys-account'});
    if(request.method==='POST'&&url.pathname==='/v1/activation/request')return await requestActivation(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/activation/verify')return await verifyActivation(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/password-recovery/request')return await requestPasswordRecovery(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/password-recovery/verify')return await verifyPasswordRecovery(request,env);
    if(request.method==='GET'&&url.pathname==='/v1/license/status')return await licenseStatus(url,env);
    return json({error:'Rota nao encontrada.'},404);
  }catch(error){return json({error:error?.message||'Falha interna.'},Number(error?.statusCode)||500);}
}

export default {fetch:handleRequest};
export {D1AccountStore,digestToken,normalizeEmail};