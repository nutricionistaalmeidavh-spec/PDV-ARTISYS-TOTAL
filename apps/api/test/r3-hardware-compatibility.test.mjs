import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createSpoolQueue} from '../../../tools/local-hardware-bridge/bridge.mjs';

const root=resolve(new URL('../../../',import.meta.url).pathname);
const read=p=>readFileSync(join(root,p),'utf8');
const matrix=JSON.parse(read('docs/parity/hardware-compatibility.json'));

test('cap-043 versioned R3 compatibility matrix names all four protocols, evidence and denies unearned FIELD_VERIFIED',()=>{
  assert.equal(matrix.schemaVersion,2);
  assert.equal(matrix.desktopBaselineCommit,'7efea9c61f75be1536a1e516e917218f2b8bf2bf');
  assert.match(matrix.registryVersion,/^r3-hardware-contracts-20\d{2}-\d{2}-\d{2}$/);
  const statuses=new Set(['PROTOCOL_VERIFIED','FIELD_VERIFIED','UNTESTED_MODEL','PARTIAL','UNSUPPORTED']);
  const ids=new Set(),verified=new Set();
  for(const entry of matrix.entries){
    assert.ok(!ids.has(entry.id),'duplicate hardware profile '+entry.id);
    ids.add(entry.id);
    assert.ok(statuses.has(entry.status),'unsupported hardware status '+entry.id);
    assert.ok(['PRINTER','SCALE','DRAWER','SCANNER'].includes(entry.kind));
    assert.ok(Array.isArray(entry.os)&&entry.os.length>0);
    assert.ok(entry.model&&entry.manufacturer&&entry.transport&&entry.limitations);
    if(entry.status==='PROTOCOL_VERIFIED'){
      verified.add(entry.kind);
      assert.ok(entry.evidence?.testFile&&entry.evidence?.testContains);
      const evidence=read(entry.evidence.testFile);
      assert.ok(evidence.includes(entry.evidence.testContains),'missing executable proof '+entry.id);
    }
    if(entry.status==='FIELD_VERIFIED'){
      assert.ok(entry.fieldEvidence?.hardwareSerial&&entry.fieldEvidence?.testedAt,
        'physical status requires a real field report');
    }
  }
  assert.deepEqual([...verified].sort(),['DRAWER','PRINTER','SCALE','SCANNER']);
  assert.equal(matrix.entries.some(entry=>entry.status==='FIELD_VERIFIED'),false,
    'protocol simulation is not physical certification');
  assert.ok(matrix.entries.some(entry=>entry.status==='UNTESTED_MODEL'));
});

test('cap-043 simulated disconnected local printer retries only FAILED and survives restart without duplicate print',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'pdv-r3-compat-')),path=join(folder,'queue.sqlite');
  let attempts=0;
  try{
    let queue=createSpoolQueue(path,{spool:async()=>{
      attempts++;
      if(attempts===1)throw new Error('SIMULATED_DEVICE_DISCONNECTED');
    }});
    const receipt={id:'r3-printer-sim-01',saleId:'r3-sale-01',text:'LOJA R3\nCUPOM NAO FISCAL\n'};
    const first=await queue.submit(receipt);
    assert.equal(first.status,'FAILED');
    assert.equal(first.attempts,1);
    queue.close();
    queue=createSpoolQueue(path,{spool:async()=>{attempts++;}});
    assert.equal(queue.get(receipt.id).status,'FAILED');
    assert.equal(attempts,1,'restart must not resend automatically');
    const second=await queue.retry(receipt.id);
    assert.equal(second.status,'SUBMITTED');
    assert.equal(second.attempts,2);
    assert.equal(attempts,2);
    assert.equal((await queue.submit(receipt)).status,'SUBMITTED');
    assert.equal(attempts,2,'idempotency keeps just one successful spool submission');
    queue.close();
  }finally{rmSync(folder,{recursive:true,force:true});}
});
