import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';

function registration(){return{protocol_version:1,telemetry_schema_version:1,installation_id:'11111111-1111-4111-8111-111111111111',app_version:'1.4.1',release_id:'abc123',database_schema_version:42};}

test('duplicate installation registration returns 409 instead of rotating credential',async()=>{
  let inserted=false;
  const DB={prepare(sql){return{bind(){return this;},async run(){if(sql.includes('INSERT INTO installations')){if(inserted)throw new Error('UNIQUE constraint failed: installations.installation_id');inserted=true;return{meta:{changes:1}};}throw new Error(`unexpected SQL: ${sql}`);}};}};
  const env={DB,ANALYTICS:{writeDataPoint(){}}};
  const make=()=>new Request('https://x/v1/installations/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(registration())});
  const first=await handleRequest(make(),env);assert.equal(first.status,201);const firstBody=await first.json();assert.ok(firstBody.credential);
  const second=await handleRequest(make(),env);assert.equal(second.status,409);const secondBody=await second.json();assert.equal(Object.hasOwn(secondBody,'credential'),false);
});
