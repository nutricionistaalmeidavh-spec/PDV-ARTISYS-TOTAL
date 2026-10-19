'use strict';
// One click means one attempt against an authenticated server lease.
// Bridge job identity is stable across retries; SUBMITTED is an OS spooler acceptance,
// never proof paper was printed. No automatic retries for uncertain outcomes.
(function(root){
 async function dispatch({api,bridge,job}){
  if(!job||!['PENDING','FAILED'].includes(job.status))throw Error('Ticket já em envio ou indisponível.');
  if(!bridge?.pairedToken?.())throw Error('Pareamento do conector local obrigatório antes do envio.');
  const p='/api/v1/restaurant/kitchen/print-jobs/'+encodeURIComponent(job.id);
  const document=await api.request(p+'/document');
  if(document?.fiscal!==false||document.documentType!=='KITCHEN_TICKET'||typeof document.text!=='string')
   throw Error('Documento da cozinha inválido.');
  const claim=await api.request(p+'/claim',{method:'POST',body:{}});
  if(claim?.job?.status!=='LEASED'||!claim.job.leaseToken)throw Error('Reserva de impressão inválida.');
  let status='FAILED',error=null;
  try{
   const result=await bridge.request('/v1/print',{id:'kds-'+job.id,saleId:job.payload.orderId,text:document.text});
   const spool=result?.job?.status;
   if(spool==='SUBMITTED')status='PRINTED';
   else if(spool==='UNCERTAIN')error='Resultado incerto no spooler. Confira o equipamento antes de tentar novamente.';
   else error='Falha da impressão local: '+String(result?.job?.error||spool||'sem resultado');
  }catch(e){error=String(e?.message||'Conector local indisponível.');}
  await api.request(p+'/ack',{method:'POST',body:{leaseToken:claim.job.leaseToken,status,
    ...(error?{error:error.slice(0,200)}:{})}});
  if(status!=='PRINTED')throw Error(error||'Falha de impressão local.');
  return {id:job.id,status,spoolSubmitted:true,physicallyPrinted:false};
 }
 root.PdvR3KitchenDispatch=Object.freeze({dispatch});
})(window);
