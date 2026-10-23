import test from 'node:test';
import assert from 'node:assert/strict';
import {pollRemoteOnce} from '../../../tools/local-hardware-bridge/remote-relay.mjs';

test('phase 5: remote PC submits exactly one local SQLite job and acknowledges spooler only',async()=>{
 const seen=[],calls=[];
 const job={id:'e2d5b1cc-a762-46cd-8ee0-d9935dfbd24c',saleId:'sale-from-phone',leaseToken:'f'.repeat(64),text:'CUPOM NAO FISCAL\nTOTAL 10,00'};
 const request=async(path,body)=>{calls.push({path,body});return path==='/next'?{job}:{job:{status:body.status}};};
 const queue={submit:async local=>{seen.push(local);return {status:'SUBMITTED'};}};
 const result=await pollRemoteOnce({request,queue});
 assert.equal(result.status,'SUBMITTED');
 assert.equal(result.physicallyPrinted,false);
 assert.equal(seen[0].id,'relay-'+job.id);
 assert.equal(calls[1].body.status,'SUBMITTED');
});
test('phase 6: disconnected spooler reports FAILED or UNCERTAIN, never silently retries',async()=>{
 const job={id:'a5da2111-7906-4acb-b383-ef2eb706c063',saleId:'sale-phone-2',leaseToken:'e'.repeat(64),text:'TICKET'};
 let n=0;
 const request=async(path,body)=>path==='/next'?{job}:{job:{status:body.status}};
 const result=await pollRemoteOnce({request,queue:{submit:async()=>{n++;throw Error('Local DB unavailable');}}});
 assert.equal(result.status,'UNCERTAIN');assert.equal(n,1);
});
test('phase 6: malicious or malformed remote job is never submitted to spooler',async()=>{
 let n=0;
 const request=async()=>({job:{id:'garbage',saleId:'sale-phone-2',leaseToken:'0'.repeat(64),text:'ESC\x1b'}});
 await assert.rejects(pollRemoteOnce({request,queue:{submit:async()=>{n++;}}}),/inválido/);
 assert.equal(n,0);
});
