function safeArray(value){return Array.isArray(value)?value:[];}
function withContractId(value,contractId){
  if(value&&typeof value==='object'&&!Array.isArray(value))return{...value,contractId:value.contractId||contractId};
  return{contractId,value};
}
function harnessFailure({id,error}){
  const message=error?.message||String(error);
  return{
    check:{name:id,category:'crosscut',status:'failed',critical:true,error:message,contractId:id},
    finding:{code:'qa-harness-error',name:id,severity:'critical',contractId:id,message},
  };
}

export async function runCrosscutContracts({contracts=[],context={},policy={}}={}){
  if(!Array.isArray(contracts))throw new TypeError('contracts must be an array');
  const checks=[];
  const findings=[];
  const evidence=[];
  const consoleErrors=[];
  const networkErrors=[];
  const coverage={discovered:contracts.length,covered:0,uncovered:0,uncoveredCritical:0};

  for(const contract of contracts){
    const id=String(contract?.id||'').trim();
    const critical=contract?.critical!==false;
    const contractId=id||'unnamed-contract';
    let coverageRecorded=false;

    try{
      if(!id||typeof contract?.runContract!=='function')throw new TypeError('contract id and runContract are required');
      const result=await contract.runContract(context,policy);
      if(result?.status==='not-applicable'){
        const reason=String(result?.reason||'').trim();
        if(!reason)throw new Error('not-applicable contract requires an explicit reason');
        coverage.uncovered++;
        if(critical)coverage.uncoveredCritical++;
        coverageRecorded=true;
        checks.push({name:id,category:'crosscut',status:'not-applicable',critical,details:{reason},contractId:id});
        continue;
      }

      coverage.covered++;
      coverageRecorded=true;
      const contractChecks=safeArray(result?.checks);
      if(contractChecks.length){
        for(const check of contractChecks){
          checks.push({
            ...check,
            name:String(check?.name||id),
            category:String(check?.category||'crosscut'),
            status:String(check?.status||'unknown').toLowerCase(),
            critical:check?.critical==null?critical:Boolean(check.critical),
            contractId:check?.contractId||id,
          });
        }
      }else{
        checks.push({name:id,category:'crosscut',status:'passed',critical,contractId:id});
      }
      for(const finding of safeArray(result?.findings))findings.push(withContractId(finding,id));
      for(const item of safeArray(result?.evidence)){
        if(typeof item==='string')evidence.push({contractId:id,path:item});
        else evidence.push(withContractId(item,id));
      }
      for(const item of safeArray(result?.consoleErrors))consoleErrors.push(withContractId(item,id));
      for(const item of safeArray(result?.networkErrors))networkErrors.push(withContractId(item,id));
    }catch(error){
      if(!coverageRecorded){
        coverage.uncovered++;
        if(critical)coverage.uncoveredCritical++;
      }
      const failure=harnessFailure({id:contractId,error});
      checks.push(failure.check);
      findings.push(failure.finding);
    }
  }

  return{checks,findings,coverage,evidence,consoleErrors,networkErrors};
}
