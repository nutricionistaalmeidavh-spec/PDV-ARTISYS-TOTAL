'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

test('critical barcode and stock state survives a real SQLite runtime close and reopen',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-qa-restart-'));
  const dbPath=path.join(dir,'pdv.sqlite');
  const actor={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};
  try{
    let first=createPdvRuntime({dbPath});
    first.catalog.createUser({id:'admin',username:'qa-persist-admin',name:'QA Admin',profileId:'profile-administrator',password:'senha-forte-qa-123'},actor);
    first.catalog.upsertProduct({
      id:'persist-product',name:'Produto Persistente',sku:'PERSIST-01',
      barcode:'0007891234567',salePriceCents:1234,costCents:500,
      trackStock:true,minimumStock:1,active:true
    },actor);
    first.inventory.move({productId:'persist-product',type:'opening',quantityDelta:7,reason:'QA restart'},actor);
    first.close();
    first=null;

    const reopened=createPdvRuntime({dbPath});
    try{
      const product=reopened.catalog.getProduct('persist-product');
      assert.equal(product.barcode,'0007891234567');
      assert.equal(product.sku,'PERSIST-01');
      assert.equal(reopened.inventory.getBalance('persist-product'),7);
      assert.ok(reopened.catalog.listProducts().some(item=>item.id==='persist-product'));
    }finally{reopened.close();}
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
