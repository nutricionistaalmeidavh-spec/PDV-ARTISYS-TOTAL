import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {openLocalDatabase} from './local-db.mjs';
import {createApi} from './worker.mjs';
import {serveLocalPwa} from './local-static.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const db=openLocalDatabase(process.env.LOCAL_DB_PATH || resolve(here,'../.local/pdv-total.sqlite'));
db.exec(readFileSync(resolve(here,'../migrations/0001_identity.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0002_commerce.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0003_cash_finance.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0004_advanced_finance.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0005_vertical_parity.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0006_desktop_parity.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0007_stock_transfers.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0008_transaction_reversals.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0009_catalog_inventory.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0010_purchase_orders.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0011_product_media.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0012_sale_item_notes.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0013_cash_terminals.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0014_checkout_configurations.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0015_seller_sales_targets.sql'),'utf8'));
db.exec(readFileSync(resolve(here,'../migrations/0016_inventory_lot_receipts.sql'),'utf8'));
const host=process.env.PDV_HOST||'127.0.0.1',port=Number(process.env.PORT||4175);
// Plain HTTP + insecure dev cookie must never be exposed on the local network.
if(!['127.0.0.1','localhost'].includes(host))throw new Error('Servidor sem TLS somente em localhost.');
const webDir=resolve(here,'../../../dist/web');
if(!existsSync(resolve(webDir,'index.html')))
  throw new Error('PWA não compilada: execute npm run build na raiz antes de iniciar o servidor local.');
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT inválida.');
const api=createApi({DB:db,COOKIE_SECURE:'false',AUTH_ENABLED:process.env.AUTH_ENABLED||'false',LOCAL_MEDIA_ENABLED:'true'});
const server=createServer(async(req,res)=>{
  try{
    const origin=`http://${req.headers.host||'127.0.0.1:'+port}`;
    const url=new URL(req.url||'/',origin);
    // The dev server must not bind to non-loopback hosts with insecure cookies.
    if(!['localhost','127.0.0.1'].includes(url.hostname)){
      res.writeHead(403);res.end();return;
    }
    if(!url.pathname.startsWith('/api/')){
      const asset=await serveLocalPwa(url.pathname,{rootDir:webDir,method:req.method});
      res.writeHead(asset.status,Object.fromEntries(asset.headers.entries()));
      res.end(Buffer.from(await asset.arrayBuffer()));return;
    }
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>262144){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const body=Buffer.concat(chunks);
    const request=new Request(url,{method:req.method,headers:req.headers,
      ...(['GET','HEAD'].includes(req.method)?{}:{body})});
    const result=await api.fetch(request);
    res.writeHead(result.status,Object.fromEntries(result.headers.entries()));
    res.end(Buffer.from(await result.arrayBuffer()));
  }catch(error){console.error('Local API error',error?.name||'Error');res.writeHead(500);res.end();}
});
server.listen(port,host,()=>console.log(`PDV TOTAL self-hosted PWA + API em http://${host}:${port}; acesso somente loopback`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
