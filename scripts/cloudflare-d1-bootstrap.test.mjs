import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isProductionWorkersBuild,
  chooseDedicatedDatabase,
  configForRemoteSchema,
  hasCompleteSchema,
} from './cloudflare-d1-bootstrap.mjs';

const buildEnv={
  WORKERS_CI:'1',WORKERS_CI_BRANCH:'main',
  WORKERS_CI_BUILD_UUID:'0682b378-c5a5-44f8-8fa5-a1b0058534c8',
  WORKERS_CI_COMMIT_SHA:'f60365df9ae5c1701daa7349ac1b530448595ac5'
};

test('remote D1 setup runs only in production Cloudflare Worker Builds',()=>{
  assert.equal(isProductionWorkersBuild(buildEnv),true);
  for(const override of [
    {WORKERS_CI_BRANCH:'feature/preview'},
    {WORKERS_CI:'0'},
    {WORKERS_CI_BUILD_UUID:''},
    {WORKERS_CI_COMMIT_SHA:''},
    {WORKERS_CI_COMMIT_SHA:'junk'}
  ])assert.equal(isProductionWorkersBuild({...buildEnv,...override}),false);
  assert.equal(isProductionWorkersBuild({CI:'true',GITHUB_ACTIONS:'true',GITHUB_REF_NAME:'main'}),false);
});
test('only the isolated canonical D1 database may be migrated',()=>{
  const db={uuid:'12345678-1234-1234-1234-123456789abc',name:'pdv-artisys-total'};
  assert.deepEqual(chooseDedicatedDatabase([db,{name:'desktop-licenses',uuid:'55555555-5555-5555-5555-555555555555'}]),db);
  assert.throws(()=>chooseDedicatedDatabase([]),/not found/i);
  assert.throws(()=>chooseDedicatedDatabase([db,db]),/exactly one/i);
  assert.throws(()=>chooseDedicatedDatabase([{...db,uuid:'bad'}]),/uuid/i);
});
test('temporary config retains original worker settings and applies only to dedicated D1',()=>{
  const cfg={name:'pdv-artisys-total',main:'apps/api/src/worker.mjs',assets:{directory:'./dist/web'},
    vars:{AUTH_ENABLED:'false'},
    d1_databases:[{binding:'DB',database_name:'pdv-artisys-total',migrations_dir:'apps/api/migrations'}],
    r2_buckets:[{binding:'FILES'}]};
  const assigned=configForRemoteSchema(cfg,'12345678-1234-1234-1234-123456789abc');
  assert.equal(assigned.d1_databases[0].database_id,'12345678-1234-1234-1234-123456789abc');
  assert.equal(assigned.d1_databases[0].migrations_dir,'apps/api/migrations');
  assert.equal(assigned.vars.AUTH_ENABLED,'false');
  assert.equal(cfg.d1_databases[0].database_id,undefined);
  assert.throws(()=>configForRemoteSchema({...cfg,d1_databases:[{binding:'DB',database_name:'desktop-license'}]},'12345678-1234-1234-1234-123456789abc'),/dedicated/i);
});
test('healthy new D1 database has schema even when there are no users',()=>{
  assert.equal(hasCompleteSchema([{name:'tenants'},{name:'users'},{name:'r4_table_prepayments'},{name:'d1_migrations'},{name:'saas_subscriptions'},{name:'saas_invitations'},{name:'public_signup_throttles'}]),true);
  assert.equal(hasCompleteSchema([{name:'tenants'},{name:'users'},{name:'d1_migrations'}]),false);
});
