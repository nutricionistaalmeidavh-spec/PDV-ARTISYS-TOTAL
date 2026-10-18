// R1 is 21 capabilities, NOT another 21 feature implementations.
// Each capability runs the already-existing REAL API/SQLite contract cases
// (not a file-existence probe). Suite failures block promotion. No hardware QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const EVIDENCE={
  "cap-004": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "product editing and deactivation retain canonical sale snapshots, enforce tenant RBAC and idempotency"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "R1 checkout-011/012: replayed customer and seller selections cannot reverse newer edits"
    }
  ],
  "cap-005": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P3 configured item derives variant/addition prices on server and preserves the chosen snapshot after catalogue changes"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "R1 checkout-017/019: configured item quantity, removal and stale replay preserve parent totals"
    }
  ],
  "cap-006": [
    {
      "file": "apps/api/test/p2-catalog-inventory.test.mjs",
      "name": "P2 category, barcode and parent/variant identity are tenant-safe, searchable, and enforce unique barcode"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P2 FEFO lot balances follow a sold item and its partial refund without duplicate stock"
    }
  ],
  "cap-007": [
    {
      "file": "apps/api/test/p2-catalog-inventory.test.mjs",
      "name": "P2 kit sells components once and returns the original immutable allocation without duplicated stock movements"
    }
  ],
  "cap-008": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "R1 checkout-017/019: configured item quantity, removal and stale replay preserve parent totals"
    },
    {
      "file": "apps/api/test/p2-catalog-inventory.test.mjs",
      "name": "P2 kit sells components once and returns the original immutable allocation without duplicated stock movements"
    }
  ],
  "cap-011": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P3 immutable stock ledger: receipt is idempotent and balance is projection"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P5 minimum stock settings are validated, atomic, idempotent and tenant/branch/RBAC isolated"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P4 stock coverage derives reserved availability and demand from immutable movement history, not static defaults"
    }
  ],
  "cap-012": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "checkout-008/nominal checkout-payment-desktop-nominal-v1 compares mixed tender and cash ledger"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "checkout-008/failure-recovery payment-recovery-desktop-v2 pays exactly once on retry"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "checkout-008/authorization payment-authorization-desktop-v2 refuses readonly completion without ledger effects"
    }
  ],
  "cap-013": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P3 line note is atomic and idempotent, preserved in completed sale and cannot be edited afterwards"
    },
    {
      "file": "apps/api/test/peripherals-web.test.mjs",
      "name": "comprovante web só aceita venda concluída e escapa entradas"
    },
    {
      "file": "apps/api/test/peripherals-web.test.mjs",
      "name": "diálogo de impressão não altera a venda nem afirma sucesso físico"
    }
  ],
  "cap-014": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P3 cash: closing uses original cash rules, net change, supplies, withdrawals and immutable journal"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P3 independent terminal drawers link every sale to its originating open cash session"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P3 full cash register search filters status/operator/time and paginates without changing legacy session list"
    }
  ],
  "cap-015": [
    {
      "file": "apps/api/test/p1-reversals.test.mjs",
      "name": "P1: completed sale cancellation reverses stock, commission and net cash exactly once, using the current cash session"
    },
    {
      "file": "apps/api/test/p1-reversals.test.mjs",
      "name": "P1: partial returns honor allocated discounts, individual quantities, and refund ceilings across retries"
    },
    {
      "file": "apps/api/test/p1-reversals.test.mjs",
      "name": "P1 regression: two terminals cannot reverse the same item twice, even with distinct mutation ids"
    }
  ],
  "cap-016": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P4 finance: manual payable/receivable ledger settles partially, prevents overpay, never double-posts sales"
    },
    {
      "file": "apps/api/test/p1-reversals.test.mjs",
      "name": "P1: financial settlement reversal reopens receivable with immutable original and prevents double reversal"
    }
  ],
  "cap-017": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P4 reports: summed sales, noncash breakdown and bounded CSV are tenant scoped and read-only"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P5 sales CSV rejects over-limit periods without silent truncation, scoped by company"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P4 comparative report compares periods with no division by zero or cross-tenant leak"
    }
  ],
  "cap-018": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P4 historical margin snapshots cost at sale time, correctly nets refunds, and never rewrites cost after a later purchase"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P4 historical margin does not claim proven profit for products without recorded acquisition costs"
    },
    {
      "file": "apps/api/test/p2-purchasing.test.mjs",
      "name": "weighted average acquisition cost reports actual purchase quantities without rewriting history"
    }
  ],
  "cap-019": [
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "inventory transfer moves one immutable stock quantity across two tenant branches atomically"
    },
    {
      "file": "apps/api/test/p2-catalog-inventory.test.mjs",
      "name": "P2 stock reservations block checkout stock debit, allow explicit release and never overcommit on concurrent writes"
    },
    {
      "file": "apps/api/test/p1-stock-locations.test.mjs",
      "name": "P1 internal storage location is only an address; canonical stock ledger and available quantity never change"
    }
  ],
  "cap-020": [
    {
      "file": "apps/api/test/p2-purchasing.test.mjs",
      "name": "purchase order receives in partial batches with exact immutable stock and cost movements"
    },
    {
      "file": "apps/api/test/p2-purchasing.test.mjs",
      "name": "purchase receipts are idempotent and concurrent terminal overreceipt is rejected atomically"
    },
    {
      "file": "apps/api/test/p2-purchasing.test.mjs",
      "name": "weighted average acquisition cost reports actual purchase quantities without rewriting history"
    }
  ],
  "cap-021": [
    {
      "file": "apps/api/test/vertical-parity.test.mjs",
      "name": "R4 cap-033/cap-037: retirada vira exatamente uma venda com preços congelados e estoque só no checkout"
    },
    {
      "file": "apps/api/test/vertical-parity.test.mjs",
      "name": "R4 cap-037/038: counter ticket daily sequence and delivery courier events use same order"
    },
    {
      "file": "apps/api/test/p2-catalog-inventory.test.mjs",
      "name": "P2 stock reservations block checkout stock debit, allow explicit release and never overcommit on concurrent writes"
    }
  ],
  "cap-022": [
    {
      "file": "apps/api/test/vertical-parity.test.mjs",
      "name": "P7 quote confirmation converts at the quoted price into one canonical sale"
    },
    {
      "file": "apps/api/test/vertical-parity.test.mjs",
      "name": "R4 cap-032: equal split plus explicit service charge posts through one sale and immutable tenders"
    }
  ],
  "cap-023": [
    {
      "file": "apps/api/test/vertical-parity.test.mjs",
      "name": "P7 wholesale: quantity tier quote keeps immutable price snapshot and branch isolation"
    },
    {
      "file": "apps/api/test/vertical-parity.test.mjs",
      "name": "P7 quote confirmation converts at the quoted price into one canonical sale"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "R1 checkout-011/012: replayed customer and seller selections cannot reverse newer edits"
    }
  ],
  "cap-024": [
    {
      "file": "apps/api/test/vertical-parity.test.mjs",
      "name": "R1 cap-024: customer wholesale policy is editable, tenant-scoped and enforced at canonical checkout"
    },
    {
      "file": "apps/api/test/vertical-parity.test.mjs",
      "name": "P7 crediário and commissions are posted once in canonical sale completion, not as duplicate cash"
    },
    {
      "file": "apps/api/test/p1-reversals.test.mjs",
      "name": "P1: crediário cancellation reverses outstanding credit and earned commissions, but never generates a second sale"
    }
  ],
  "cap-040": [
    {
      "file": "apps/api/test/p2-catalog-inventory.test.mjs",
      "name": "P2 category, barcode and parent/variant identity are tenant-safe, searchable, and enforce unique barcode"
    },
    {
      "file": "apps/api/test/commerce.test.mjs",
      "name": "P3 configured item derives variant/addition prices on server and preserves the chosen snapshot after catalogue changes"
    }
  ],
  "cap-052": [
    {
      "file": "apps/api/test/p2-csv-import.test.mjs",
      "name": "P2 import CSV preview parses quotes, validates rows, reports duplicates and never writes products"
    },
    {
      "file": "apps/api/test/p2-csv-import.test.mjs",
      "name": "P2 CSV commit is all-or-nothing, idempotent and retains existing tenant product identity"
    },
    {
      "file": "apps/api/test/p2-csv-import.test.mjs",
      "name": "R1 cap-052 import mutation key cannot acknowledge a different CSV without writing its goods"
    },
    {
      "file": "apps/api/test/p2-csv-import.test.mjs",
      "name": "P1 assisted CSV upsert changes existing catalogue identity without recreating stock or sales snapshots"
    }
  ]
};
const stdoutByFile=new Map();
function escaped(value){return value.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g,'\\$&');}
function proveCapability(id){
  const cases=EVIDENCE[id];
  assert.ok(Array.isArray(cases)&&cases.length>0,'Sem cenários executáveis para '+id);
  for(const {file,name} of cases){
    if(!stdoutByFile.has(file)){
      const selected=[...new Set(Object.values(EVIDENCE).flat()
        .filter(item=>item.file===file).map(item=>item.name))];
      const matcher=selected.map(escaped).join('|');
      // Run only selected, real integration tests against their own fresh SQLite
      // instances; this is a separate explicit R1 regression gate.
      // Node's parent test runner exports NODE_TEST_CONTEXT=child-v8.
      // It must not leak into a distinct child test-runner instance: that
      // environment would silently suppress its TAP output (false green).
      const env={...process.env};delete env.NODE_TEST_CONTEXT;
      const result=execFileSync(process.execPath,[
        '--experimental-sqlite','--test','--test-name-pattern='+matcher,resolve(ROOT,file)
      ],{cwd:ROOT,env,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
      assert.match(result,/# fail 0(?:\r?\n|$)/,'Fluxos de '+file+' falharam');
      stdoutByFile.set(file,result);
    }
    const lines=stdoutByFile.get(file).split(/\r?\n/);
    assert.ok(lines.some(line=>new RegExp('^ok \\d+ - '+escaped(name)+'$').test(line)),
      'Teste de negócio não executado ou ignorado em '+file+': '+name);
  }
  return cases.length;
}

test('cap-004 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-004');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-004');
});

test('cap-005 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-005');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-005');
});

test('cap-006 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-006');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-006');
});

test('cap-007 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-007');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-007');
});

test('cap-008 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-008');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-008');
});

test('cap-011 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-011');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-011');
});

test('cap-012 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-012');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-012');
});

test('cap-013 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-013');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-013');
});

test('cap-014 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-014');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-014');
});

test('cap-015 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-015');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-015');
});

test('cap-016 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-016');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-016');
});

test('cap-017 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-017');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-017');
});

test('cap-018 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-018');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-018');
});

test('cap-019 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-019');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-019');
});

test('cap-020 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-020');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-020');
});

test('cap-021 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-021');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-021');
});

test('cap-022 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-022');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-022');
});

test('cap-023 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-023');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-023');
});

test('cap-024 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-024');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-024');
});

test('cap-040 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-040');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-040');
});

test('cap-052 R1 — aceite automatizado dos fluxos de negócio',()=>{
  const checks=proveCapability('cap-052');
  assert.ok(checks>=1,'Nenhuma prova operacional executada para cap-052');
});
