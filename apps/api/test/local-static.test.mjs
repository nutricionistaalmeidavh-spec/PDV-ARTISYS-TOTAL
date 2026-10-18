import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveLocalPwa} from '../src/local-static.mjs';

test('PWA shell is served on the same local origin without exposing source files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pdv-local-pwa-'));
  try{
    await writeFile(join(root,'index.html'),'<h1>PDV TOTAL</h1>');
    await writeFile(join(root,'sw.js'),'self.addEventListener("fetch",()=>{})');
    await mkdir(join(root,'icons'));
    await writeFile(join(root,'icons','pdv-total-192.png'),Buffer.from([137,80,78,71]));
    const shell=await serveLocalPwa('/',{rootDir:root});
    assert.equal(shell.status,200);assert.match(await shell.text(),/PDV TOTAL/);
    assert.match(shell.headers.get('content-type'),/text\/html/);
    assert.equal(shell.headers.get('cache-control'),'no-store');
    const worker=await serveLocalPwa('/sw.js',{rootDir:root});
    assert.equal(worker.status,200);
    const image=await serveLocalPwa('/icons/pdv-total-192.png',{rootDir:root});
    assert.equal(image.status,200);
    const head=await serveLocalPwa('/index.html',{rootDir:root,method:'HEAD'});
    assert.equal(head.status,200);assert.equal(await head.text(),'');
    const mutation=await serveLocalPwa('/index.html',{rootDir:root,method:'POST'});
    assert.equal(mutation.status,405);
    assert.equal((await serveLocalPwa('/missing.js',{rootDir:root})).status,404);
    assert.equal((await serveLocalPwa('/.env',{rootDir:root})).status,400);
    assert.equal((await serveLocalPwa('/%2e%2e/private.js',{rootDir:root})).status,400);
    assert.equal((await serveLocalPwa('/%5csecret.js',{rootDir:root})).status,400);
    assert.equal((await serveLocalPwa('/secret.sqlite',{rootDir:root})).status,404);
    const outside=join(root,'..','outside-pdv-test.js');
    await writeFile(outside,'secret');
    await symlink(outside,join(root,'escape.js'));
    const escape=await serveLocalPwa('/escape.js',{rootDir:root});
    assert.equal(escape.status,403);
    await rm(outside);
  }finally{await rm(root,{recursive:true,force:true});}
});
