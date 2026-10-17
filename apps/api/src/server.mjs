import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {openLocalDatabase} from './local-db.mjs';
import {createApi} from './worker.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const db=openLocalDatabase(process.env.LOCAL_DB_PATH || resolve(here,'../.local/pdv-total.sqlite'));
db.exec(readFileSync(resolve(here,'../migrations/0001_identity.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0002_commerce.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0003_cash_finance.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0004_vertical_parity.sql'),'utf8'));
const host=process.env.PDV_HOST||'127.0.0.1',port=Number(process.env.PORT||4175);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT inválida.');
const api=createApi({DB:db,COOKIE_SECURE:'false',AUTH_ENABLED:process.env.AUTH_ENABLED||'false'});
const server=createServer(async(req,res)=>{
  try{
    const origin=`http://${req.headers.host||'127.0.0.1:'+port}`;
    const url=new URL(req.url||'/',origin);
    // The dev server must not bind to non-loopback hosts with insecure cookies.
    if(!['localhost','127.0.0.1'].includes(url.hostname)){
      res.writeHead(403);res.end();return;
    }
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const body=Buffer.concat(chunks);
    const request=new Request(url,{method:req.method,headers:req.headers,
      ...(['GET','HEAD'].includes(req.method)?{}:{body})});
    const result=await api.fetch(request);
    res.writeHead(result.status,Object.fromEntries(result.headers.entries()));
    res.end(Buffer.from(await result.arrayBuffer()));
  }catch(error){console.error('Local API error',error?.name||'Error');res.writeHead(500);res.end();}
});
server.listen(port,host,()=>console.log(`PDV TOTAL identity API (dev) em http://${host}:${port}; sem renderer e sem operações comerciais`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
