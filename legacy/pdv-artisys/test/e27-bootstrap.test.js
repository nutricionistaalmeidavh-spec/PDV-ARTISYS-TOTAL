'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {resolveBootstrapConfig,validateBootstrapConfig,shouldStartEmbeddedServer,PROFILE_SERVER_TERMINAL,PROFILE_TERMINAL,DEFAULT_ACCOUNT_ENDPOINT}=require('../desktop/bootstrap-config.cjs');

test('server-terminal is the safe default and owns the local SQLite server',()=>{
 const config=resolveBootstrapConfig({env:{}});assert.equal(config.profile,PROFILE_SERVER_TERMINAL);assert.equal(shouldStartEmbeddedServer(config),true);assert.equal(config.apiBase,null);
 assert.equal(config.accountEndpoint,DEFAULT_ACCOUNT_ENDPOINT);assert.equal(config.requireCommercialActivation,true);
});

test('official desktop defaults to mandatory commercial activation and allows an explicit internal override',()=>{
 const official=resolveBootstrapConfig({env:{}});
 assert.equal(official.accountEndpoint,DEFAULT_ACCOUNT_ENDPOINT);assert.equal(official.requireCommercialActivation,true);
 const internal=resolveBootstrapConfig({env:{PDV_ACCOUNT_ENDPOINT:'https://account.example/',PDV_REQUIRE_COMMERCIAL_ACTIVATION:'false'}});
 assert.equal(internal.accountEndpoint,'https://account.example/');assert.equal(internal.requireCommercialActivation,false);
});

test('terminal profile requires a remote LAN API and never owns SQLite',()=>{
 const config=resolveBootstrapConfig({env:{PDV_DEPLOYMENT_PROFILE:'terminal',PDV_SERVER_URL:'http://192.168.1.10:4174',PDV_TERMINAL_ID:'PDV-02',PDV_TERMINAL_KEY:'paired-secret'}});
 assert.equal(config.profile,PROFILE_TERMINAL);assert.equal(config.apiBase,'http://192.168.1.10:4174');assert.equal(config.terminalId,'PDV-02');assert.equal(config.terminalKey,'paired-secret');assert.equal(shouldStartEmbeddedServer(config),false);assert.doesNotThrow(()=>validateBootstrapConfig(config));
});

test('terminal profile rejects missing server URL or non-http endpoint',()=>{
 assert.throws(()=>validateBootstrapConfig({profile:'terminal',apiBase:null,terminalId:'PDV-02',terminalKey:'x'}),/servidor/i);
 assert.throws(()=>validateBootstrapConfig({profile:'terminal',apiBase:'file:///tmp/db',terminalId:'PDV-02',terminalKey:'x'}),/http/i);
});

test('bootstrap config can be persisted without storing admin credentials',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-bootstrap-'));const configPath=path.join(dir,'deployment.json');try{
   fs.writeFileSync(configPath,JSON.stringify({profile:'terminal',apiBase:'http://10.0.0.2:4174',terminalId:'PDV-03',terminalName:'Balcao 3',terminalKey:'pair-key',username:'admin',password:'never',accountEndpoint:'https://must-not-persist.example',requireCommercialActivation:true}));
   const config=resolveBootstrapConfig({env:{},configPath});assert.equal(config.profile,'terminal');assert.equal(config.terminalId,'PDV-03');assert.equal('username' in config,false);assert.equal('password' in config,false);assert.equal(config.accountEndpoint,DEFAULT_ACCOUNT_ENDPOINT);assert.equal(config.requireCommercialActivation,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
