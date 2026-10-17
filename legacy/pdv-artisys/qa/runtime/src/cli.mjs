#!/usr/bin/env node

if(process.argv[2]==='crosscut'){
  const path=await import('node:path');
  const {loadQaManifest}=await import('./manifest.js');
  const {runCrosscutProfile}=await import('./crosscut-profile.js');
  const args=process.argv.slice(3);
  const value=name=>{
    const index=args.indexOf(`--${name}`);
    if(index<0)return null;
    const next=args[index+1];
    return next&&!next.startsWith('--')?next:true;
  };
  const config=value('config');
  if(!config||config===true)throw new Error('crosscut requires --config <file>');
  const {manifest,rootDir}=await loadQaManifest(String(config));
  const output=value('output');
  const result=await runCrosscutProfile({
    manifest,
    rootDir,
    environment:value('environment')===true?null:value('environment'),
    viewport:value('viewport')===true?null:value('viewport'),
    outputRoot:output&&output!==true?path.resolve(String(output)):path.resolve('qa-artifacts'),
  });
  console.log(JSON.stringify({profile:result.profile,gate:result.productGate,counts:result.summary.counts,artifacts:result.artifacts},null,2));
}else{
  await import('./cli-core.mjs');
}
