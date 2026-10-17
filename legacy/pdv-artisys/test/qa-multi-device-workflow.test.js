'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.join(__dirname,'..');
const workflowPath=path.join(root,'.github','workflows','qa-multi-device-lan.yml');
const runnerPath=path.join(root,'qa','multi-device','run.mjs');

test('multi-device LAN QA is isolated in a manual-only workflow',()=>{
  assert.equal(fs.existsSync(workflowPath),true,'workflow qa-multi-device-lan.yml must exist');
  const workflow=fs.readFileSync(workflowPath,'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^\s*push:/m);
  assert.doesNotMatch(workflow,/^\s*pull_request:/m);
  assert.doesNotMatch(workflow,/^\s*schedule:/m);
  for(const profile of ['smoke','full','stress']) assert.match(workflow,new RegExp('\\b'+profile+'\\b'));
});

test('multi-device LAN QA runner exposes business invariant coverage',()=>{
  assert.equal(fs.existsSync(runnerPath),true,'qa/multi-device/run.mjs must exist');
  const syntax=spawnSync(process.execPath,['--check',runnerPath],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  const runner=fs.readFileSync(runnerPath,'utf8');
  for(const invariant of [
    'terminal-onboarding-pairing',
    'price-propagation',
    'cashier-ui-price-propagation',
    'sale-stock-decrement',
    'last-unit-race',
    'idempotent-completion',
    'cash-session-isolation',
    'restaurant-kds-flow',
    'authorization-boundaries',
    'database-invariants'
  ]) assert.ok(runner.includes(invariant),invariant);
  assert.match(runner,/requireTerminalAuth:true/,'LAN QA must authenticate paired terminals');
  assert.match(runner,/electron\.launch/,'full LAN QA must exercise a real remote Electron cashier');
  assert.match(runner,/data-add-product='qa-ui-price'/,'cashier UI must assert the price on the POS product card');
  assert.match(runner,/\/api\/v1\/restaurant\/sessions\/'\+opened\.body\.id\+'\/checkout/,'restaurant QA must reach checkout');
  assert.match(runner,/qa-waiter-device-2/,'restaurant QA must cover concurrent waiters');
  assert.match(runner,/PRAGMA integrity_check/,'QA must validate SQLite integrity');
  assert.match(runner,/PRAGMA foreign_key_check/,'QA must validate foreign keys');
});


test('Electron QA harness provides isolated safeStorage for terminal credentials',()=>{
  const harness=fs.readFileSync(path.join(root,'qa','desktop','main.cjs'),'utf8');
  assert.match(harness,/ARTISYS_QA/);
  assert.match(harness,/safeStorage\.isEncryptionAvailable/);
  assert.match(harness,/safeStorage\.encryptString/);
  assert.match(harness,/safeStorage\.decryptString/);
});


test('stress profile homologates the requested LAN scale and aggressive order ramp',()=>{
  const runner=fs.readFileSync(runnerPath,'utf8');
  assert.ok(runner.includes('scale-10-cashiers-15-waiters-13-orders'),'stress must cover the exact requested topology');
  assert.ok(runner.includes('aggressive-order-ramp'),'stress must include the aggressive load ramp');
  assert.match(runner,/const SCALE_CASHIERS=10\b/);
  assert.match(runner,/const SCALE_WAITERS=15\b/);
  assert.match(runner,/const SCALE_SIMULTANEOUS_ORDERS=13\b/);
  assert.match(runner,/const AGGRESSIVE_ORDER_LEVELS=\[100,250,500\]/);
  assert.match(runner,/const LOAD_REQUEST_TIMEOUT_MS=90000\b/,'extreme 500-order benchmark must not be cut off by the normal 30s client timeout');
  assert.match(runner,/p50Ms/);
  assert.match(runner,/p95Ms/);
  assert.match(runner,/maxMs/);
  assert.match(runner,/Promise\.all/,'load must actually issue concurrent work');
});
