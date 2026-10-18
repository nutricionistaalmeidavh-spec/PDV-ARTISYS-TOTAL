import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

// The published desktop scripts use CommonJS. This repository is ESM, so
// execute the byte-identical published source with an isolated CommonJS module
// object rather than changing its extension, rewriting it or altering its hash.
function loadPinnedDesktopCommonJs(relativePath,dependencies={}){
 const module={exports:{}};
 runInNewContext(readFileSync(new URL(relativePath,import.meta.url),'utf8'),{
   module,require(name){
     if(!Object.hasOwn(dependencies,name))throw Error('Unexpected legacy import '+name);
     return dependencies[name];
   }
 },{filename:relativePath,timeout:500});
 return module.exports;
}
const policy=loadPinnedDesktopCommonJs('../../web/access-policy.js');
const ui=loadPinnedDesktopCommonJs('../../web/ui-model.js');
const {homeForUser}=loadPinnedDesktopCommonJs('../../web/home-role-model.js',{
 './access-policy':policy
});
const fixture=JSON.parse(readFileSync(new URL('../../../docs/parity/fixtures/p5-home-roles-desktop-pinned.json',import.meta.url)));
function gitBlobSha(file){
 const body=readFileSync(new URL(file,import.meta.url));
 return createHash('sha1').update('blob '+body.length+'\0').update(body).digest('hex');
}
function user(entry,tenant='tenant-a'){
 return {tenantId:tenant,profile:{id:tenant+':'+entry.label,name:entry.label},permissions:[...entry.permissions]};
}
function tiles(u){return Array.from(homeForUser(u,ui.HOME_TILES).sections,s=>Array.from(s.tiles,t=>t.route)).flat();}
function expected(label){const row=fixture.profiles.find(p=>p.label===label);assert.ok(row);return row;}

test('home-002/nominal p5-home-roles-desktop-pinned-v1 executable original desktop role vectors',()=>{
 assert.equal(fixture.desktop.commit,'7efea9c61f75be1536a1e516e917218f2b8bf2bf');
 assert.equal(gitBlobSha('../../web/home-role-model.js'),fixture.desktop.modelBlob);
 assert.equal(gitBlobSha('../../web/access-policy.js'),fixture.desktop.policyBlob);
 for(const profile of fixture.profiles){
   const u=user(profile);
   assert.deepEqual(tiles(u),profile.tiles,'pinned desktop home tile vector '+profile.label);
   assert.equal(policy.canAccessRoute(u,'reports'),profile.reports);
 }
 assert.deepEqual(tiles(user(expected('operador'))),['checkout','cash','post-sale','catalog']);
});

test('home-002/authorization p5-home-roles-desktop-pinned-v1 unauthorized shortcuts are absent and navigation fails closed',()=>{
 const operator=user(expected('operador'));
 assert.equal(policy.canAccessRoute(operator,'reports'),false);
 assert.equal(policy.canAccessRoute(operator,'access'),false);
 assert.equal(policy.canAccessRoute(operator,'settings'),false);
 assert.equal(tiles(operator).includes('financial-management'),false);
 const manager=user(expected('gestor'));
 assert.equal(policy.canAccessRoute(manager,'reports'),true);
 assert.equal(policy.canAccessRoute(manager,'financial-management'),true);
 assert.deepEqual(tiles(manager),expected('gestor').tiles);
});

test('home-002/tenant-isolation p5-home-roles-desktop-pinned-v1 no module visibility leaks between distinct tenant permission contexts',()=>{
 const a=user(expected('gestor'),'tenant-a');
 const b=user(expected('sem-permissao'),'tenant-b');
 assert.deepEqual(tiles(a),expected('gestor').tiles);
 assert.deepEqual(tiles(b),[]);
 assert.equal(policy.canAccessRoute(b,'reports'),false);
 assert.equal(policy.canAccessRoute(a,'reports'),true);
 assert.deepEqual(tiles(b),[],'role model is stateless across stores');
});

test('home-002/failure-recovery p5-home-roles-desktop-pinned-v1 denied navigation does not corrupt authorized shortcut state',()=>{
 const operator=user(expected('operador'));
 const before=tiles(operator);
 assert.equal(policy.canAccessRoute(operator,'reports'),false);
 assert.equal(policy.canAccessRoute(operator,'unknown-route'),false);
 assert.deepEqual(tiles(operator),before);
 const restored=user(expected('gestor'));
 assert.deepEqual(tiles(restored),expected('gestor').tiles);
 assert.deepEqual(tiles(operator),before,'role changes must not mutate other sessions');
});
