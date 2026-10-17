#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {qrSvg}=require('../../js/core/mobile-access/qr-code');

function run(command,args,{encoding='utf8'}={}){
  const result=spawnSync(command,args,{encoding});
  if(result.error)throw new Error(`${command} unavailable: ${result.error.message}`);
  if(result.status!==0)throw new Error(`${command} failed (${result.status}): ${String(result.stderr||'').trim()}`);
  return result.stdout;
}

async function main(){
  const dir=await mkdtemp(path.join(tmpdir(),'artisys-semantic-artifacts-'));
  try{
    const payload='http://127.0.0.1:4174/mobile?qa=0007891234567';
    const svgPath=path.join(dir,'mobile-access.svg');
    const pngPath=path.join(dir,'mobile-access.png');
    const svg=qrSvg(payload,{scale:10,border:4});
    assert.match(svg,/data-qr-payload=/);
    await writeFile(svgPath,svg,'utf8');

    run('rsvg-convert',['-o',pngPath,svgPath]);
    const decoded=String(run('zbarimg',['--quiet','--raw',pngPath])).trim();
    assert.equal(decoded,payload,'rendered QR must decode to the original payload');

    console.log(JSON.stringify({
      ok:true,
      checks:[{
        artifact:'mobile-access-qr',
        source:'js/core/mobile-access/qr-code.js',
        decodedPayload:decoded
      }]
    },null,2));
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
}

main().catch(error=>{
  console.error(error?.stack||error);
  process.exitCode=1;
});
