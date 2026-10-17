import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname||new URL('..',import.meta.url).pathname,'..');
const config=JSON.parse(readFileSync(resolve(root,'wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
const must=(condition,message)=>{if(!condition)throw new Error('Cloudflare build: '+message);};
must(config.name==='pdv-artisys-total','Worker name does not match Cloudflare project');
must(config.main==='apps/api/src/worker.mjs','only the canonical API entrypoint may deploy');
must(existsSync(resolve(root,config.main)),'Worker entrypoint not found');
must(config.d1_databases?.length===1&&config.d1_databases[0].binding==='DB','one distinct D1 DB binding required');
must(config.d1_databases[0].database_name==='pdv-artisys-total','cannot share desktop D1');
must(!config.d1_databases[0].database_id||config.d1_databases[0].database_id!=='00000000-0000-0000-0000-000000000000','placeholder D1 ID forbidden');
must(config.r2_buckets?.length===1&&config.r2_buckets[0].binding==='FILES','R2 binding must be explicit');
must(existsSync(resolve(root,'apps/api/migrations/0001_identity.sql')),'identity schema missing');
console.log('PDV Total: Cloudflare root, canonical API, D1 and R2 configuration valid. No UI build or paid dependencies.');
