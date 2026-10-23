// A computer polls the canonical API over outbound HTTPS; its local bridge stays loopback-only.
export async function pollRemoteOnce({request,queue}={}){
 if(typeof request!=='function'||!queue?.submit)throw new Error('Conector remoto incompleto.');
 const response=await request('/next',{});
 const job=response?.job;
 if(!job)return {idle:true};
 if(!/^[a-f0-9-]{36}$/i.test(String(job.id||''))||
    !/^[a-zA-Z0-9_-]{4,120}$/.test(String(job.saleId||''))||
    !/^[a-f0-9]{64}$/.test(String(job.leaseToken||''))||
    typeof job.text!=='string'||!job.text.trim()||job.text.length>14000||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(job.text))throw new Error('Trabalho remoto inválido: não imprimir.');
 let status='UNCERTAIN',message='';
 try{
  // Idempotent local queue is the same queue used by the existing local printer.
  const spool=await queue.submit({id:'relay-'+job.id,saleId:job.saleId,text:job.text});
  status=spool.status==='SUBMITTED'?'SUBMITTED':
    spool.status==='FAILED'?'FAILED':'UNCERTAIN';
  message=spool.error||'';
 }catch(e){
  // No automatic retry if the remote lease/spooler outcome is ambiguous.
  status='UNCERTAIN';message=String(e.message||e);
 }
 const ack=await request('/ack',{jobId:job.id,leaseToken:job.leaseToken,status,...(message?{error:message.slice(0,200)}:{})});
 return {id:job.id,status:ack?.job?.status||status,spoolSubmitted:status==='SUBMITTED',physicallyPrinted:false};
}
