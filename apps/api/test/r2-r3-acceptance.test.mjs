// Partial software acceptance: replay REAL, pre-existing API/SQLite/Node tests per
// canonical R2 and R3 capability. One selected test is a proven implemented slice;
// it is NOT certification of complete desktop parity or physical devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const EVIDENCE={
  "cap-001": [
    [
      "apps/api/test/local-migrations.test.mjs",
      "selfhost canonical migrations run once"
    ]
  ],
  "cap-002": [
    [
      "apps/api/test/https-lan-server.test.mjs",
      "cap-002 LAN: two authenticated HTTPS terminals"
    ]
  ],
  "cap-003": [
    [
      "apps/api/test/r2-lan-operations.test.mjs",
      "R2: hashed one-use pairing, branch+operator scope, revocation, read-only and tenant isolation"
    ]
  ],
  "cap-010": [
    [
      "apps/api/test/r2-lan-operations.test.mjs",
      "R2 optional modules: FOOD and WHOLESALE stay tenant-scoped, reversible and audited"
    ]
  ],
  "cap-044": [
    [
      "apps/api/test/r2-lan-operations.test.mjs",
      "R2: hashed one-use pairing, branch+operator scope, revocation, read-only and tenant isolation"
    ]
  ],
  "cap-045": [
    [
      "apps/api/test/r2-lan-operations.test.mjs",
      "R2: hashed one-use pairing, branch+operator scope, revocation, read-only and tenant isolation"
    ]
  ],
  "cap-046": [
    [
      "apps/api/test/r2-lan-operations.test.mjs",
      "R2: hashed one-use pairing, branch+operator scope, revocation, read-only and tenant isolation"
    ]
  ],
  "cap-051": [
    [
      "scripts/selfhost-backup.test.mjs",
      "WAL-aware backup stays consistent and restore never overwrites"
    ],
    [
      "scripts/selfhost-backup.test.mjs",
      "backup SHA tampering blocks restore before writing a file"
    ]
  ],
  "cap-053": [
    [
      "apps/api/test/r2-lan-operations.test.mjs",
      "R2: support diagnostics ZIP contains no password, cookie, email or credentials"
    ]
  ],
  "cap-054": [
    [
      "apps/api/test/r2-lan-operations.test.mjs",
      "R2: support diagnostics ZIP contains no password, cookie, email or credentials"
    ]
  ],
  "cap-055": [
    [
      "apps/api/test/r2-lan-operations.test.mjs",
      "R2: pilot readiness stays incomplete until explicit evidence, with isolated persisted entries"
    ]
  ],
  "cap-056": [
    [
      "apps/api/test/r2-lan-operations.test.mjs",
      "R2: hashed one-use pairing, branch+operator scope, revocation, read-only and tenant isolation"
    ]
  ],
  "cap-025": [
    [
      "apps/api/test/vertical-parity.test.mjs",
      "R4 cap-034: kitchen print outbox claims one job at a time and retries failed printer safely"
    ]
  ],
  "cap-026": [
    [
      "apps/api/test/r4-print-agent.test.mjs",
      "KDS agent calls CUPS using argv, never shell or interpreted product commands"
    ]
  ],
  "cap-027": [
    [
      "apps/api/test/peripherals-web.test.mjs",
      "sem permissão explícita não tenta ler porta física"
    ]
  ],
  "cap-028": [
    [
      "apps/api/test/peripherals-web.test.mjs",
      "Urano POP-S rejeita frames incompletos, resposta numérica solta e tara"
    ]
  ],
  "cap-029": [
    [
      "apps/api/test/peripherals-web.test.mjs",
      "comprovante web só aceita venda concluída e escapa entradas"
    ]
  ],
  "cap-050": [
    [
      "apps/api/test/peripherals-web.test.mjs",
      "ESC/POS conserva quebras e emite apenas bytes de comandos esperados"
    ]
  ]
};
const ran=new Map();
function escapeRegex(s){return s.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g,'\\$&');}
function partialEvidence(id){
 const examples=EVIDENCE[id];
 assert.ok(examples?.length,'No executable business case for '+id);
 for(const [file,name] of examples){
  if(!ran.has(file)){
   const selected=[...new Set(Object.values(EVIDENCE).flat().filter(([p])=>p===file).map(([,label])=>label))];
   const matcher=selected.map(escapeRegex).join('|');
   const env={...process.env};delete env.NODE_TEST_CONTEXT;
   const output=execFileSync(process.execPath,['--experimental-sqlite','--test','--test-name-pattern='+matcher,resolve(ROOT,file)],
    {cwd:ROOT,env,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
   assert.match(output,/# fail 0(?:\r?\n|$)/,'Business regression failed '+file);
   ran.set(file,output);
  }
  assert.ok(ran.get(file).split(/\r?\n/).some(line=>new RegExp('^ok \\d+ - '+escapeRegex(name)+'$').test(line)),
   'Missing, skipped or failed real test '+file+': '+name);
 }
 return examples.length;
}
test('cap-001 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-001');
 assert.ok(checks>=1,'No executed checks for cap-001');
});

test('cap-002 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-002');
 assert.ok(checks>=1,'No executed checks for cap-002');
});

test('cap-003 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-003');
 assert.ok(checks>=1,'No executed checks for cap-003');
});

test('cap-010 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-010');
 assert.ok(checks>=1,'No executed checks for cap-010');
});

test('cap-044 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-044');
 assert.ok(checks>=1,'No executed checks for cap-044');
});

test('cap-045 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-045');
 assert.ok(checks>=1,'No executed checks for cap-045');
});

test('cap-046 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-046');
 assert.ok(checks>=1,'No executed checks for cap-046');
});

test('cap-051 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-051');
 assert.ok(checks>=1,'No executed checks for cap-051');
});

test('cap-053 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-053');
 assert.ok(checks>=1,'No executed checks for cap-053');
});

test('cap-054 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-054');
 assert.ok(checks>=1,'No executed checks for cap-054');
});

test('cap-055 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-055');
 assert.ok(checks>=1,'No executed checks for cap-055');
});

test('cap-056 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-056');
 assert.ok(checks>=1,'No executed checks for cap-056');
});

test('cap-025 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-025');
 assert.ok(checks>=1,'No executed checks for cap-025');
});

test('cap-026 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-026');
 assert.ok(checks>=1,'No executed checks for cap-026');
});

test('cap-027 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-027');
 assert.ok(checks>=1,'No executed checks for cap-027');
});

test('cap-028 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-028');
 assert.ok(checks>=1,'No executed checks for cap-028');
});

test('cap-029 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-029');
 assert.ok(checks>=1,'No executed checks for cap-029');
});

test('cap-050 R2/R3 executable partial implementation acceptance',()=>{
 const checks=partialEvidence('cap-050');
 assert.ok(checks>=1,'No executed checks for cap-050');
});
