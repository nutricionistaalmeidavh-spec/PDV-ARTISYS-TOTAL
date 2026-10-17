async function setupTutorial(page,scenario,runtimeContext){
  const state=await page.evaluate(async scenario=>{
    const api=new window.PdvApiClient.ApiClient();
    const config=await api.initialize();
    const session=await api.currentSession();
    const operatorId=session?.user?.id||session?.userId||'qaadmin';
    const vars={terminalId:config.terminalId,operatorId,scenario};

    async function ensureProduct(){
      const product=await api.saveProduct({id:'tutorial-product',name:'Produto Tutorial',sku:'TUT-001',barcode:'789000000001',categoryId:null,unit:'UN',usageType:'DIRECT',salePriceCents:1000,costCents:400,minimumStock:2,trackStock:true,menuEnabled:true,active:true});
      try{await api.saveInventoryMovement({productId:product.id,type:'adjustment-in',quantityDelta:20,reason:'Estoque tutorial'});}catch{}
      return product;
    }
    async function ensureCustomer(){return api.saveCustomer({id:'tutorial-customer',name:'Cliente Tutorial',document:'',phone:'',email:'',creditLimitCents:0,active:true});}
    async function ensureLocation(){
      const rows=await api.stockLocations(true).catch(()=>[]);
      if(rows.some(row=>row.id==='MAIN'))return 'MAIN';
      const created=await api.createStockLocation({id:'MAIN',name:'Principal',type:'STORE'});
      return created.id||'MAIN';
    }
    async function ensureSupplier(){return api.saveSupplier({id:'tutorial-supplier',name:'Fornecedor Tutorial',document:'',phone:'',email:'',active:true});}
    async function ensureCash(){
      let cash=null;try{cash=await api.openCash(config.terminalId);}catch{}
      if(!cash){const opened=await api.createCash({terminalId:config.terminalId,initialCashCents:10000});cash=opened.session||opened;}
      return cash;
    }
    async function completeTutorialSale(){
      await ensureCash();await ensureProduct();await ensureCustomer();
      const sale=await api.openSale({saleNumber:'TUT-'+Date.now(),terminalId:config.terminalId,sellerId:operatorId});
      await api.setSaleCustomer(sale.id,'tutorial-customer');
      const withItem=await api.addSaleItem(sale.id,'tutorial-product',1);
      const result=await api.completeSale(withItem.id,[{method:'PIX',amountCents:1000}]);
      const completed=result.sale||result;
      vars.saleId=completed.id;vars.saleNumber=completed.saleNumber||completed.id;
      return completed;
    }

    if(scenario!=='product-create')await ensureProduct();
    if(!['product-create','user-create','permissions','pair-terminal','printer-config','printer-diagnostics','backup','restore','modules'].includes(scenario))await ensureCustomer();

    if(['sale-history','return','commissions'].includes(scenario))await completeTutorialSale();

    if(['purchase-create','purchase-ordered'].includes(scenario)){
      await ensureLocation();
      const supplier=await ensureSupplier();
      if(scenario==='purchase-ordered'){
        const po=await api.createPurchaseOrder({supplierId:supplier.id||'tutorial-supplier',locationId:'MAIN',items:[{productId:'tutorial-product',quantity:10,unitCostCents:450}]});
        const ordered=await api.submitPurchaseOrder(po.id);
        vars.purchaseOrderId=ordered.id||po.id;
      }
    }

    if(['order-create','order-fulfill'].includes(scenario)){
      await ensureLocation();
      if(scenario==='order-fulfill'){
        await ensureCash();
        const quote=await api.createSalesQuote({customerId:'tutorial-customer',locationId:'MAIN',fulfillmentType:'PICKUP',items:[{productId:'tutorial-product',quantity:2}]});
        const confirmed=await api.confirmSalesOrder(quote.id);
        vars.salesOrderId=confirmed.id||quote.id;
      }
    }

    if(scenario==='finance'){
      const today=new Date().toISOString().slice(0,10);
      await api.createFinanceEntry({kind:'PAYABLE',description:'Fornecedor Tutorial',amountCents:3500,dueAt:today,competencyDate:today});
      await api.createFinanceEntry({kind:'RECEIVABLE',description:'Cliente Tutorial',amountCents:5000,dueAt:today,competencyDate:today});
    }

    if(scenario==='commissions'){
      try{await api.saveCommissionRule({sellerId:operatorId,productId:'tutorial-product',percent:5,active:true});}catch{}
    }

    if(scenario==='pair-terminal'){
      try{
        await window.artisysDesktop.dataServer.save({mode:'lan-host',host:'127.0.0.1',port:4174},api.sessionToken);
      }catch{}
    }

    if(scenario==='restore'){
      const backup=await api.createBackup('tutorial-restore');
      vars.backupId=backup.id||backup.backup?.id||null;
    }
    return vars;
  },scenario);

  runtimeContext.vars={...(runtimeContext.vars||{}),...state};
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000});
  await page.locator('#app-topbar').waitFor({state:'visible',timeout:15000});
}

async function fillEphemeralPassword(page){
  const value='Qa-'+Date.now().toString(36)+'-A9!';
  await page.locator('[data-person-form] input[name="password"]').fill(value);
}

export default {capabilities:{
  'tutorial.setup':async({page,step,runtimeContext})=>setupTutorial(page,step.scenario||'base',runtimeContext),
  'tutorial.fillEphemeralPassword':async({page})=>fillEphemeralPassword(page)
}};
