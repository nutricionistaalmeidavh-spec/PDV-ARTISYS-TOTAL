'use strict';
(() => {
  const root=window;
  const url='http://127.0.0.1:8765';
  const key='pdv-total.local-pairing';
  function pairedToken(){return String(root.sessionStorage?.getItem(key)||'');}
  function pair(token){
    const v=String(token||'').trim();
    if(!/^[a-f0-9]{64}$/.test(v))throw new Error('Código de pareamento inválido (64 caracteres).');
    root.sessionStorage?.setItem(key,v);
  }
  async function request(path,body=null){
    if(!pairedToken())throw new Error('Informe o código de pareamento em Dispositivos locais.');
    let response;
    try{
      response=await root.fetch(url+path,{
        method:body===null?'GET':'POST',
        cache:'no-store',
        headers:{authorization:'Bearer '+pairedToken(),...(body===null?{}:{'content-type':'application/json'})},
        ...(body===null?{}:{body:JSON.stringify(body)})
      });
    }catch{throw new Error('Conector local indisponível neste computador.');}
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'Falha na impressão local.');
    return result;
  }
  async function pairAutomatically(){
    let res;
    try{
      res=await root.fetch(url+'/v1/pair',{method:'POST',cache:'no-store',
        headers:{'content-type':'application/json'},body:'{}'});
    }catch{throw new Error('Conector local não encontrado. Instale e inicie o conector no computador.');}
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Pareamento não autorizado. Confira o computador.');
    pair(data.token);
    return getStatus();
  }
  const configureRemote=details=>request('/v1/remote/configure',details);
  const getPrinters=()=>request('/v1/printers');
  const selectPrinter=name=>request('/v1/printers/select',{name});
  const getStatus=()=>request('/v1/status');
  const jobs=()=>request('/v1/jobs');
  const retry=id=>request('/v1/jobs/'+encodeURIComponent(id)+'/retry',{});
  const drawer=()=>request('/v1/drawer/open',{});
  async function print(sale,text,{reprint=false}={}){
    if(sale?.status!=='COMPLETED')throw new Error('Somente venda concluída pode gerar comprovante.');
    const id=String(sale.id||'');
    if(!/^[A-Za-z0-9_-]{4,100}$/.test(id))throw new Error('Identificador da venda inválido.');
    // The first copy is idempotent; an operator-initiated reprint gets its own
    // identity and cannot be mistaken for a retry of an uncertain spool job.
    if(reprint && typeof root.crypto?.randomUUID!=='function')
      throw new Error('Reimpressão requer identificador seguro no navegador.');
    const jobId=reprint?'reprint-'+root.crypto.randomUUID():'receipt-'+id;
    const result=await request('/v1/print',{id:jobId,saleId:id,text});
    if(result.job?.status==='FAILED')throw new Error(result.job.error||'Falha na impressora local.');
    if(result.job?.status==='UNCERTAIN')throw new Error('Resultado incerto. Confira o equipamento antes de reimprimir.');
    return result.job;
  }
  root.PdvLocalBridge=Object.freeze({pair,pairAutomatically,pairedToken,request,getStatus,configureRemote,getPrinters,selectPrinter,jobs,retry,drawer,print});
})();
