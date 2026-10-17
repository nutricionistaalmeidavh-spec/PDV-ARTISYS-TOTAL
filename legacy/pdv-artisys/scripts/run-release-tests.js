'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const dir=path.join(process.cwd(),'test','release');
const files=fs.readdirSync(dir).filter(name=>name.endsWith('.test.js')).sort().map(name=>path.join('test','release',name));
if(!files.length){console.error('Nenhum teste de release encontrado.');process.exit(1);}
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});
if(result.error){console.error(result.error);process.exit(1);}
process.exit(result.status??1);
