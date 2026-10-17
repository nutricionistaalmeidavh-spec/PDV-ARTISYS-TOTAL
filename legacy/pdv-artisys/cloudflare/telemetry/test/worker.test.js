import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistration, validateBatch } from '../src/schema.js';
import { hashCredential } from '../src/auth.js';
import { handleRequest } from '../src/index.js';

class FakeStatement {
  constructor(db,sql){this.db=db;this.sql=sql.replace(/\s+/g,' ').trim();this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    if(this.sql.includes('FROM installations WHERE credential_hash')){const row=[...this.db.installations.values()].find(item=>item.credential_hash===this.args[0]);return row||null;}
    return null;
  }
  async run(){
    const s=this.sql;const a=this.args;
    if(s.startsWith('INSERT INTO installations')){this.db.installations.set(a[0],{installation_id:a[0],credential_hash:a[1],first_seen_at:a[2],last_seen_at:a[3],last_app_version:a[4],last_release_id:a[5],telemetry_schema_version:a[6]});return{meta:{changes:1}};}
    if(s.startsWith('UPDATE installations SET last_seen_at')){const row=this.db.installations.get(a[3]);if(row){row.last_seen_at=a[0];row.last_app_version=a[1];row.last_release_id=a[2];}return{meta:{changes:row?1:0}};}
    if(s.startsWith('DELETE FROM event_receipts'))return{meta:{changes:0}};
    if(s.startsWith('INSERT OR IGNORE INTO event_receipts')){if(this.db.receipts.has(a[0]))return{meta:{changes:0}};this.db.receipts.add(a[0]);return{meta:{changes:1}};}
    if(s.startsWith('INSERT INTO error_fingerprints')){const [fingerprint,subsystem,operation,firstSeen,lastSeen]=a;const existing=this.db.fingerprints.get(fingerprint);if(existing){existing.last_seen_at=lastSeen;existing.occurrence_count+=1;}else this.db.fingerprints.set(fingerprint,{fingerprint,subsystem,operation,first_seen_at:firstSeen,last_seen_at:lastSeen,occurrence_count:1,affected_installations:0});return{meta:{changes:1}};}
    if(s.startsWith('INSERT OR IGNORE INTO error_fingerprint_installations')){const key=`${a[0]}|${a[1]}`;const fresh=!this.db.fingerprintInstallations.has(key);this.db.fingerprintInstallations.add(key);return{meta:{changes:fresh?1:0}};}
    if(s.startsWith('UPDATE error_fingerprints SET affected_installations')){const fingerprint=a[0];const row=this.db.fingerprints.get(fingerprint);if(row)row.affected_installations=[...this.db.fingerprintInstallations].filter(k=>k.startsWith(`${fingerprint}|`)).length;return{meta:{changes:row?1:0}};}
    throw new Error(`Unhandled SQL: ${s}`);
  }
}
class FakeD1 {constructor(){this.installations=new Map();this.receipts=new Set();this.fingerprintInstallations=new Set();this.fingerprints=new Map();}prepare(sql){return new FakeStatement(this,sql);}}
function env(){const points=[];return{DB:new FakeD1(),ANALYTICS:{writeDataPoint:point=>points.push(point)},points};}
function registration(){return{protocol_version:1,telemetry_schema_version:1,installation_id:'11111111-1111-4111-8111-111111111111',app_version:'1.4.1',release_id:'abc123',database_schema_version:42};}
function event(overrides={}){return{schema_version:1,event_id:'22222222-2222-4222-8222-222222222222',event_name:'operation_failed',occurred_at:'2026-09-25T20:00:00.000Z',installation_id:'11111111-1111-4111-8111-111111111111',terminal_id:'33333333-3333-4333-8333-333333333333',session_id:'44444444-4444-4444-8444-444444444444',app_version:'1.4.1',release_id:'abc123',database_schema_version:42,dimensions:{module:'sales',operation:'http_request',subsystem:'api',error_class:'http_5xx',fingerprint:'ERR-a83f29a83f29a83f'},measurements:{duration_ms:31},...overrides};}

test('schema rejects unknown fields and sensitive values on the Worker too',()=>{
  assert.throws(()=>validateRegistration({...registration(),email:'a@b.com'}),/campo/i);
  assert.throws(()=>validateBatch({schema_version:1,events:[event({dimensions:{...event().dimensions,token:'secret'}})]}),/campo|sens/i);
  assert.throws(()=>validateBatch({schema_version:1,events:Array.from({length:51},()=>event())}),/50/);
});

test('health is public and internal failures are 500, never disguised as auth/client errors',async()=>{
  const healthy=await handleRequest(new Request('https://x/health'),env());assert.equal(healthy.status,200);assert.equal((await healthy.json()).schemaVersion,1);
  const broken={DB:{prepare(){throw new Error('D1 exploded');}},ANALYTICS:{writeDataPoint(){}}};
  const response=await handleRequest(new Request('https://x/v1/events',{method:'POST',headers:{authorization:'Bearer abc','content-type':'application/json'},body:'{"schema_version":1,"events":[]}' }),broken);assert.equal(response.status,500);
});

test('registration returns plaintext credential once while D1 stores only its hash',async()=>{
  const e=env();const response=await handleRequest(new Request('https://x/v1/installations/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(registration())}),e);assert.equal(response.status,201);const body=await response.json();assert.ok(body.credential.length>=40);const row=e.DB.installations.get(registration().installation_id);assert.notEqual(row.credential_hash,body.credential);assert.equal(row.credential_hash,await hashCredential(body.credential));
});

test('valid ingestion writes Analytics Engine and dedupes D1 error mutation by event_id',async()=>{
  const e=env();const reg=await handleRequest(new Request('https://x/v1/installations/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(registration())}),e);const credential=(await reg.json()).credential;const batch={schema_version:1,events:[event()]};
  const send=()=>handleRequest(new Request('https://x/v1/events',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${credential}`},body:JSON.stringify(batch)}),e);
  assert.equal((await send()).status,202);assert.equal((await send()).status,202);assert.equal(e.points.length,2);const fp=e.DB.fingerprints.get('ERR-a83f29a83f29a83f');assert.equal(fp.occurrence_count,1);assert.equal(fp.affected_installations,1);
});

test('a second installation increases affected-installation count once',async()=>{
  const e=env();async function register(id){const response=await handleRequest(new Request('https://x/v1/installations/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...registration(),installation_id:id})}),e);return(await response.json()).credential;}
  const id1='11111111-1111-4111-8111-111111111111';const id2='55555555-5555-4555-8555-555555555555';const c1=await register(id1);const c2=await register(id2);
  async function send(id,credential,eventId){const body={schema_version:1,events:[event({installation_id:id,event_id:eventId})]};return handleRequest(new Request('https://x/v1/events',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${credential}`},body:JSON.stringify(body)}),e);}
  await send(id1,c1,'e-1');await send(id1,c1,'e-2');await send(id2,c2,'e-3');assert.equal(e.DB.fingerprints.get('ERR-a83f29a83f29a83f').affected_installations,2);
});
