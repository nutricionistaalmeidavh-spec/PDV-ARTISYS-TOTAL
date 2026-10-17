import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {createSpoolQueue,createBridgeServer} from '../../../tools/local-hardware-bridge/bridge.mjs';

test('local SQLite queue keeps idempotent receipt even after process restart', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pdv-spool-'));
  let sent=0;const file=join(dir,'queue.sqlite');
  try{
    const q=createSpoolQueue(file,{spool:async()=>{sent++;}});
    const input={id:'receipt-test-001',saleId:'sale-001',text:'CUPOM NAO FISCAL\nTOTAL 12.00\n'};
    let job=await q.submit(input);
    assert.equal(job.status,'SUBMITTED');
    assert.equal(job.attempts,1);
    job=await q.submit(input);
    assert.equal(job.status,'SUBMITTED');
    assert.equal(sent,1,'same job never physically submitted twice');
    await assert.rejects(q.submit({...input,text:'changed'}),/different|diferente/i);
    q.close();
    const restarted=createSpoolQueue(file,{spool:async()=>{sent++;}});
    assert.equal(restarted.get(input.id).status,'SUBMITTED');
    assert.equal((await restarted.submit(input)).status,'SUBMITTED');
    assert.equal(sent,1);
    restarted.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('failed spool job is retryable once operator requests it, not automatically',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pdv-spool-'));
  try{
    let count=0;
    const q=createSpoolQueue(join(dir,'db.sqlite'),{spool:async()=>{if(++count===1)throw Error('printer offline');}});
    const j={id:'receipt-failure-001',saleId:'sale-002',text:'HELLO'};
    const failed=await q.submit(j);
    assert.equal(failed.status,'FAILED');
    assert.equal((await q.submit(j)).status,'FAILED');
    assert.equal(count,1);
    const ok=await q.retry(j.id);
    assert.equal(ok.status,'SUBMITTED');
    assert.equal(ok.attempts,2);
    assert.equal(count,2);
    q.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('in-progress spool job recovered after crash becomes UNCERTAIN and never retries automatically',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pdv-spool-'));const file=join(dir,'db.sqlite');
  try{
    let q=createSpoolQueue(file,{spool:async()=>{}});
    await q.submit({id:'receipt-uncertain-001',saleId:'sale-003',text:'HELLO'});
    q.db.prepare("UPDATE bridge_jobs SET status='SUBMITTING' WHERE id=?").run('receipt-uncertain-001');
    q.close();
    q=createSpoolQueue(file,{spool:async()=>{throw Error('should not print');}});
    assert.equal(q.get('receipt-uncertain-001').status,'UNCERTAIN');
    await assert.rejects(q.retry('receipt-uncertain-001'),/unknown|incerto|uncertain/i);
    q.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('loopback bridge blocks wrong Origin, missing token, DNS rebinding and unsupported commands',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pdv-spool-'));
  const q=createSpoolQueue(join(dir,'db.sqlite'),{spool:async()=>{}});
  const server=createBridgeServer({queue:q,origin:'https://pdv.example.test',token:'0123456789abcdef'.repeat(4)});
  try{
    await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
    const port=server.address().port,url='http://127.0.0.1:'+port+'/v1/status';
    const request=(path,opts={})=>fetch('http://127.0.0.1:'+port+path,{headers:{origin:'https://pdv.example.test',authorization:'Bearer '+'0123456789abcdef'.repeat(4),...opts.headers},method:opts.method||'GET',body:opts.body});
    assert.equal((await request('/v1/status')).status,200);
    assert.equal((await request('/v1/status',{headers:{origin:'https://evil.example.test'}})).status,403);
    assert.equal((await request('/v1/status',{headers:{authorization:''}})).status,401);
    const wrongHost=await new Promise((resolve,reject)=>{
      const req=httpRequest({hostname:'127.0.0.1',port,path:'/v1/status',method:'GET',headers:{Host:'attacker.test',Origin:'https://pdv.example.test',Authorization:'Bearer '+'0123456789abcdef'.repeat(4)}},res=>{res.resume();resolve(res.statusCode);});
      req.on('error',reject);req.end();
    });
    assert.equal(wrongHost,403);
    assert.equal((await request('/v1/delete-all',{method:'POST',body:'{}',headers:{'content-type':'application/json'}})).status,404);
    const opt=await fetch(url,{method:'OPTIONS',headers:{origin:'https://pdv.example.test','access-control-request-private-network':'true','access-control-request-method':'POST'}});
    assert.equal(opt.status,204);
    assert.equal(opt.headers.get('access-control-allow-private-network'),'true');
  }finally{await new Promise(ok=>server.close(ok));q.close();rmSync(dir,{recursive:true,force:true});}
});


test('local serial drawer config works on macOS and Linux without sharing OS-specific stty flags', async()=>{
  const {sttyArgs}=await import('../../../tools/local-hardware-bridge/stty-args.mjs');
  const expected=['9600','cs8','-cstopb','-parenb','raw','-echo'];
  assert.deepEqual(sttyArgs('/dev/cu.usbserial-A','darwin'),['-f','/dev/cu.usbserial-A',...expected]);
  assert.deepEqual(sttyArgs('/dev/ttyUSB0','linux'),['-F','/dev/ttyUSB0',...expected]);
  assert.throws(()=>sttyArgs('/dev/ttyUSB0','win32'),/não suportado|unsupported/i);
});
