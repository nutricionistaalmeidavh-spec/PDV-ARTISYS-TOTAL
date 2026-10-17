import test from'node:test';import assert from'node:assert/strict';import{createCatalogItem,searchCatalog,resolveVariant}from'../src/index.mjs';
test('searches and resolves variants',()=>{const i=createCatalogItem({id:1,name:'Camiseta',variants:[{id:'M'}]});assert.equal(searchCatalog([i],'cam').length,1);assert.equal(resolveVariant(i,'M').id,'M')});
