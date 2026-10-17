function normalizeStatuses(value){
  const list=Array.isArray(value)?value:[value??200];
  const out=[...new Set(list.map(Number).filter(Number.isInteger))];
  if(!out.length)throw new TypeError('expectedStatus must contain at least one integer');
  return out;
}
function safePath(value){
  const text=String(value||'').trim();
  if(!text)throw new TypeError('endpoint path is required');
  return text;
}
async function readPayload(response){
  const contentType=String(response.headers?.get?.('content-type')||'');
  const text=await response.text();
  if(!text)return {contentType,text:'',json:null,jsonError:null};
  if(!contentType.includes('json'))return {contentType,text:text.slice(0,500),json:null,jsonError:null};
  try{return {contentType,text:'',json:JSON.parse(text),jsonError:null}}
  catch(error){return {contentType,text:'',json:null,jsonError:error?.message||String(error)}}
}
export async function runApiSweep({baseURL,endpoints,fetchImpl=fetch,defaultHeaders={},failFast=false}={}){
  const base=new URL(String(baseURL||''));
  if(!Array.isArray(endpoints)||!endpoints.length)throw new TypeError('endpoints must be a non-empty array');
  if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl must be a function');
  const results=[];
  for(const endpoint of endpoints){
    const name=String(endpoint.name||endpoint.path||'endpoint');
    const method=String(endpoint.method||'GET').toUpperCase();
    const path=safePath(endpoint.path);
    const expectedStatus=normalizeStatuses(endpoint.expectedStatus);
    const headers={...defaultHeaders,...(endpoint.headers||{})};
    const hasBody=endpoint.body!==undefined;
    if(hasBody&&!Object.keys(headers).some(key=>key.toLowerCase()==='content-type'))headers['content-type']='application/json';
    const started=Date.now();
    try{
      const response=await fetchImpl(new URL(path,base).toString(),{
        method,
        headers,
        body:hasBody?(typeof endpoint.body==='string'?endpoint.body:JSON.stringify(endpoint.body)):undefined,
      });
      const payload=await readPayload(response);
      let passed=expectedStatus.includes(response.status);
      const issues=[];
      if(!passed)issues.push('expected HTTP '+expectedStatus.join('/')+' but received '+response.status);
      if(endpoint.expectJson===true&&payload.json===null){
        passed=false;
        issues.push(payload.jsonError?'invalid JSON: '+payload.jsonError:'expected JSON response');
      }
      if(typeof endpoint.validate==='function'){
        try{
          const verdict=await endpoint.validate({response,payload:payload.json,text:payload.text});
          if(verdict===false){passed=false;issues.push('custom validation returned false')}
        }catch(error){
          passed=false;
          issues.push('custom validation failed: '+(error?.message||String(error)));
        }
      }
      results.push({name,method,path,status:response.status,expectedStatus,passed,durationMs:Date.now()-started,contentType:payload.contentType,issues});
      if(failFast&&!passed)break;
    }catch(error){
      results.push({name,method,path,status:null,expectedStatus,passed:false,durationMs:Date.now()-started,contentType:null,issues:[error?.message||String(error)]});
      if(failFast)break;
    }
  }
  const failed=results.filter(item=>!item.passed);
  return {schemaVersion:1,status:failed.length?'failed':'passed',total:results.length,passed:results.length-failed.length,failed:failed.length,results};
}
