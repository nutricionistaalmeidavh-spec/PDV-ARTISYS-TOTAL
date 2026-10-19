import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function app(){
 const source=readFileSync(new URL('../../web/r3-kitchen-dispatch.js',import.meta.url),'utf8');
 const root={};runInNewContext(source,{window:root});return root.PdvR3KitchenDispatch;
}
const make=({status='SUBMITTED',throwLocal=false}={})=>{
 const actions=[],job={id:'job-kds-1',status:'PENDING',payload:{orderId:'order-1'}};
 const api={request:async(path,{method,body}={})=>{
  actions.push({kind:'api',path,method,body});
  if(path.endsWith('/document'))return {id:job.id,documentType:'KITCHEN_TICKET',fiscal:false,text:'COZINHA\n'};
  if(path.endsWith('/claim'))return {job:{id:job.id,status:'LEASED',leaseToken:'a'.repeat(36)}};
  if(path.endsWith('/ack'))return {job:{status:body.status}};
  throw Error('UNEXPECTED_API');
 }};
 const bridge={pairedToken:()=> 'b'.repeat(64),request:async(path,body)=>{
  actions.push({kind:'bridge',path,body});
  if(throwLocal)throw Error('disconnected');
  return {job:{status}};
 }};
 return {api,bridge,job,actions};
};
test('cap-025 R3 kitchen dispatch uses immutable job id and acknowledges only spooler submission, not physical paper',async()=>{
 const client=make(),result=await app().dispatch(client);
 assert.equal(result.status,'PRINTED');
 assert.equal(client.actions.filter(a=>a.kind==='bridge').length,1);
 assert.equal(client.actions.find(a=>a.kind==='bridge').body.id,'kds-job-kds-1');
 assert.equal(client.actions.find(a=>a.kind==='bridge').body.text,'COZINHA\n');
 assert.equal(client.actions.find(a=>a.path?.endsWith('/ack')).body.status,'PRINTED');
});
test('cap-028 R3 uncertain and disconnected spool requires manual operator intervention, never retries automatically',async()=>{
 for(const options of [{status:'UNCERTAIN'},{status:'FAILED'},{throwLocal:true}]){
  const client=make(options);
  await assert.rejects(app().dispatch(client),/incerto|falha|disconnected|falhou/i);
  assert.equal(client.actions.filter(a=>a.kind==='bridge').length,1);
  assert.equal(client.actions.find(a=>a.path?.endsWith('/ack')).body.status,'FAILED');
 }
});
test('cap-025 R3 unpaired bridge never claims job and terminal can only claim PENDING/FAILED',async()=>{
 const client=make();client.bridge.pairedToken=()=>null;
 await assert.rejects(app().dispatch(client),/pareamento|conector/i);
 assert.equal(client.actions.length,0);
 const printed=make();printed.job.status='PRINTED';
 await assert.rejects(app().dispatch(printed),/já|indisponível/i);
 assert.equal(printed.actions.length,0);
});
