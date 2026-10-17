'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');

test('root Wrangler config deploys the license center to pdv-artisys',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  assert.equal(config.name,'pdv-artisys');
  assert.equal(config.main,'cloudflare/account/src/worker.mjs');
  assert.equal(config.compatibility_date,'2026-10-03');
  assert.equal(config.keep_vars,true);
});

test('Wrangler config reuses the existing Cloudflare binding names without hard-coded resource IDs',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  assert.deepEqual(config.d1_databases,[{binding:'artisys'}]);
  assert.deepEqual(config.r2_buckets,[{binding:'artisysr2'}]);
  assert.equal('database_id' in config.d1_databases[0],false);
  assert.equal('bucket_name' in config.r2_buckets[0],false);
});

test('Cloudflare build validates locally and never queries or creates account resources',()=>{
  const source=fs.readFileSync(path.join(root,'scripts','prepare-cloudflare-account-build.mjs'),'utf8');
  assert.doesNotMatch(source,/versions\s+list|d1\s+list|d1\s+create|r2\s+bucket\s+create/i);
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.scripts.build,'node scripts/prepare-cloudflare-account-build.mjs');
  assert.equal(pkg.scripts['test:cloudflare:account'],'node --test test/cloudflare-account-worker.test.js test/cloudflare-account-build.test.js');
});
