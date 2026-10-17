'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
const preload=fs.readFileSync(path.join(__dirname,'..','desktop','preload.cjs'),'utf8');

test('desktop main branches server ownership through deployment profile before creating runtime',()=>{
 assert.match(main,/resolveBootstrapConfig/);assert.match(main,/shouldStartEmbeddedServer\(bootstrapConfig\)/);assert.match(main,/applyPendingRestore/);assert.match(main,/bootstrapConfig\.apiBase/);
 assert.match(main,/x-terminal-id/);assert.match(main,/x-terminal-key/);
});

test('preload exposes narrow import picker without raw filesystem primitives',()=>{
 assert.match(preload,/imports/);assert.match(preload,/artisys:imports:pick/);assert.doesNotMatch(preload,/readFileSync|writeFileSync|require\(['"]node:fs/);
});
