function safeArray(value){return Array.isArray(value)?value:[];}
function lower(value){return String(value||'').trim().toLowerCase();}

export async function runRendererHealthContract({sweepResult={},policy={}}={}){
  const consoleErrors=safeArray(sweepResult.consoleErrors);
  const pageErrors=safeArray(sweepResult.pageErrors);
  const requestFailures=safeArray(sweepResult.requestFailures).map(item=>({
    ...item,
    type:'requestfailed',
    expected:item?.expected===true,
  }));
  const httpErrors=safeArray(sweepResult.httpErrors)
    .filter(item=>Number(item?.status)>=500)
    .map(item=>({...item,type:'http',expected:item?.expected===true}));
  const networkErrors=[...requestFailures,...httpErrors];
  const unexpectedNetwork=networkErrors.filter(item=>item.expected!==true);
  const blockingSeverities=new Set(safeArray(policy.blockSeverities?.length?policy.blockSeverities:['critical']).map(lower));
  const findings=safeArray(sweepResult.findings).map(item=>{
    const severity=lower(item?.severity)||'low';
    return blockingSeverities.has(severity)?{...item,severity:'critical'}:{...item,severity};
  });
  const criticalFindings=findings.filter(item=>item.severity==='critical');
  const failed=consoleErrors.length>0||pageErrors.length>0||unexpectedNetwork.length>0||criticalFindings.length>0;

  return{
    checks:[{
      name:'renderer-health',
      category:'renderer-health',
      status:failed?'failed':'passed',
      critical:true,
      error:failed?'renderer health violations detected':null,
      details:{
        consoleErrors:consoleErrors.length,
        pageErrors:pageErrors.length,
        unexpectedNetworkErrors:unexpectedNetwork.length,
        criticalFindings:criticalFindings.length,
      },
    }],
    findings,
    consoleErrors,
    networkErrors,
    evidence:safeArray(sweepResult.evidence),
  };
}
