'use strict';

(function attach(root, factory) {
  root.PdvApiClient = factory(root);
})(window, function factory(root) {
  class ApiClient {
    constructor() {
      this.webMode=!root.artisysDesktop;
      this.sessionToken=this.webMode?'':(root.sessionStorage?.getItem('artisys.sessionToken')||'');
      this.tenantId=null;
      this.branchId=null;
      this.completionKeys=new Map();
      this.config = null;
    }

    async initialize() {
      this.config = this.webMode ? {
        storeName:'PDV Total',terminalName:'Navegador',version:'Web',
        terminalId:'WEB',dataServer:{mode:'cloud',selected:true}
      } : await root.artisysDesktop.getConfig();
      return this.config;
    }

    async request(path, { method = 'GET', body, mutationId } = {}) {
      if(this.webMode)return this.webRequest(path,{method,body,mutationId});
      const persistedToken = root.sessionStorage?.getItem('artisys.sessionToken') || '';
      if (persistedToken) this.sessionToken = persistedToken;
      const result = await root.artisysDesktop.apiRequest({ path, method, body, mutationId, sessionToken: this.sessionToken });
      if (!result.ok) {
        const error = new Error(result.payload?.error || `Erro HTTP ${result.status}`);
        error.status = result.status;
        error.payload = result.payload;
        throw error;
      }
      return result.payload;
    }

    async webRequest(path,{method='GET',body,mutationId}={}){
      const url=new URL(path,root.location.origin);
      const original=url.pathname;
      const apiRoot='/api/v1/';
      if(!original.startsWith(apiRoot))throw new Error('Rota não autorizada.');
      let operation='',targetPath=original,resource='';
      const direct=['/api/v1/health','/api/v1/auth/login','/api/v1/auth/session','/api/v1/tenants'];
      if(!direct.includes(original)&&!original.startsWith('/api/v1/tenants/')){
        if(!this.tenantId||!this.branchId)throw new Error('Escolha o estabelecimento e a filial antes de continuar.');
        if(original==='/api/v1/products')operation='products';
        else if(original==='/api/v1/inventory')operation='inventory';
        else if(original==='/api/v1/inventory/movements')operation='inventory/receipts';
        else if(original==='/api/v1/cash/open')operation='cash';
        else if(original==='/api/v1/cash/sessions')operation=method==='POST'?'cash/open':'cash';
        else if(original.startsWith('/api/v1/sales'))operation=original.slice(apiRoot.length);
        else throw new Error('Este módulo ainda não está disponível na versão online.');
        targetPath=apiRoot+'tenants/'+encodeURIComponent(this.tenantId)+'/'+operation;
        if(method==='GET'||method==='DELETE')url.searchParams.set('branchId',this.branchId);
      }
      const target=new URL(targetPath,root.location.origin);
      for(const [k,v] of url.searchParams)target.searchParams.set(k,v);
      const headers={'accept':'application/json'};
      if(!['GET','HEAD'].includes(method))headers['content-type']='application/json';
      const payload=body==null?{}:{...body};
      if(!['GET','HEAD'].includes(method)){
        if(operation)payload.branchId=this.branchId;
        let key=mutationId;
        const completion=/^sales\\/[^/]+\\/complete$/.test(operation);
        if(completion){
          key=this.completionKeys.get(operation)||key||this.mutationId();
          this.completionKeys.set(operation,key);
        }
        if(!key)key=this.mutationId();
        headers['x-mutation-id']=key;
      }
      let response;
      try{response=await root.fetch(target,{method,credentials:'same-origin',headers,
        ...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(payload)})});}
      catch{throw new Error('Sem conexão. Seus dados permanecem na tela; tente novamente.');}
      let value;try{value=await response.json();}catch{value={};}
      if(!response.ok){
        const e=new Error(value.error||'Não foi possível concluir a operação.');
        e.status=response.status;
        throw e;
      }
      if(/^sales\\/[^/]+\\/complete$/.test(operation))this.completionKeys.delete(operation);
      if(operation==='products')return method==='GET'?value.products:value.product;
      if(operation==='inventory')return value.stock;
      if(operation==='inventory/receipts')return value.movement;
      if(operation==='cash'||operation==='cash/open')return value.session;
      if(operation==='sales'||operation.startsWith('sales?'))return method==='GET'?value.sales:value.sale;
      if(operation.startsWith('sales/'))return operation.endsWith('/complete')?{sale:value.sale}:value.sale;
      return value;
    }

    async chooseWebTenant(membership){
      if(!this.webMode)throw new Error('Somente para acesso web.');
      const tenantId=String(membership?.tenantId||'');
      if(!tenantId)throw new Error('Estabelecimento não disponível.');
      const [branches,context]=await Promise.all([
        this.webRequest('/api/v1/tenants/'+encodeURIComponent(tenantId)+'/branches'),
        this.webRequest('/api/v1/tenants/'+encodeURIComponent(tenantId)+'/context')
      ]);
      if(!branches.branches?.length)throw new Error('Este estabelecimento não possui filial ativa.');
      this.tenantId=tenantId;
      this.branchId=branches.branches[0].id;
      return {branch:branches.branches[0],context};
    }

    params(values = {}) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
      const text = query.toString();
      return text ? `?${text}` : '';
    }

    mutationId() { return root.crypto?.randomUUID ? root.crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
    health() { return this.request('/api/v1/health'); }
    setupStatus() { return this.request('/api/v1/setup/status'); }
    setupAdmin(body) { return this.request('/api/v1/setup/admin', { method: 'POST', body }); }
    requestSetupActivation(email) { return this.request('/api/v1/setup/activation/request', { method:'POST', body:{email} }); }
    verifySetupActivation(email, code) { return this.request('/api/v1/setup/activation/verify', { method:'POST', body:{email,code} }); }
    async login(body) {
      const result = await this.request('/api/v1/auth/login', { method: 'POST', body });
      if(this.webMode)return result;
      this.sessionToken = result.sessionToken;
      root.sessionStorage?.setItem('artisys.sessionToken', this.sessionToken);
      return result;
    }
    logout() { if(this.webMode){ this.completionKeys.clear();this.tenantId=null;this.branchId=null;return this.webRequest('/api/v1/auth/session',{method:'DELETE'}); } this.sessionToken = ''; root.sessionStorage?.removeItem('artisys.sessionToken'); }
    currentSession() { return this.request('/api/v1/auth/session'); }
    authorizeReturn(body) { return this.request('/api/v1/auth/authorize', { method:'POST', body }); }

    categories(includeInactive = false) { return this.request(`/api/v1/categories${includeInactive ? '?includeInactive=true' : ''}`); }
    saveCategory(body) { return this.request('/api/v1/categories', { method: 'POST', body }); }
    products(includeInactive = false) { return this.request(`/api/v1/products${includeInactive ? '?includeInactive=true' : ''}`); }
    saveProduct(body) { return this.request('/api/v1/products', { method: 'POST', body }); }
    removeProduct(productId) { return this.request(`/api/v1/products/${encodeURIComponent(productId)}`, { method: 'DELETE' }); }
    recipe(productId) { return this.request(`/api/v1/vertical/recipes/${encodeURIComponent(productId)}`); }
    saveRecipe(productId, body) { return this.request(`/api/v1/vertical/recipes/${encodeURIComponent(productId)}`, { method: 'PUT', body }); }
    syncProductPhotos(force = false) { return root.artisysDesktop.photos.sync({ force, sessionToken:this.sessionToken }); }
    productPhotoSyncStatus() { return root.artisysDesktop.photos.status(); }
    productPhotoDataUrl(productId, variant = 'thumbnail') { return root.artisysDesktop.photos.dataUrl({ productId, variant, sessionToken:this.sessionToken }); }
    uploadProductPhoto(productId) { return root.artisysDesktop.photos.pickAndUpload({ productId, sessionToken:this.sessionToken }); }
    removeProductPhoto(productId) { return root.artisysDesktop.photos.remove({ productId, sessionToken:this.sessionToken }); }
    customers(includeInactive = false) { return this.request(`/api/v1/customers${includeInactive ? '?includeInactive=true' : ''}`); }
    saveCustomer(body) { return this.request('/api/v1/customers', { method: 'POST', body }); }
    users(includeInactive = false) { return this.request(`/api/v1/users${includeInactive ? '?includeInactive=true' : ''}`); }
    sellers() { return this.request('/api/v1/sellers'); }
    saveUser(body) { return this.request('/api/v1/users', { method: 'POST', body }); }
    accessPermissions() { return this.request('/api/v1/access/permissions'); }
    accessProfiles(includeInactive = false) { return this.request(`/api/v1/access/profiles${includeInactive ? '?includeInactive=true' : ''}`); }
    createAccessProfile(body) { return this.request('/api/v1/access/profiles', { method:'POST', body }); }
    updateAccessProfile(id, body) { return this.request(`/api/v1/access/profiles/${encodeURIComponent(id)}`, { method:'PATCH', body }); }
    deleteAccessProfile(id) { return this.request(`/api/v1/access/profiles/${encodeURIComponent(id)}`, { method:'DELETE' }); }
    assignAccessProfile(userId, profileId) { return this.request(`/api/v1/access/users/${encodeURIComponent(userId)}/profile`, { method:'PUT', body:{profileId} }); }
    accessDevices(filters = {}) { return this.request(`/api/v1/access/devices${this.params(filters)}`); }
    accessKitchenStations() { return this.request('/api/v1/access/kitchen-stations'); }
    createAccessDevice(body) { return this.request('/api/v1/access/devices', { method:'POST', body }); }
    setAccessDeviceKitchenStations(id, stationIds) { return this.request(`/api/v1/access/devices/${encodeURIComponent(id)}/kitchen-stations`, { method:'PUT', body:{stationIds} }); }
    setAccessDeviceStatus(id, status) { return this.request(`/api/v1/access/devices/${encodeURIComponent(id)}/status`, { method:'PATCH', body:{status} }); }
    rotateAccessDevice(id) { return this.request(`/api/v1/access/devices/${encodeURIComponent(id)}/rotate`, { method:'POST', body:{} }); }
    accessSecurity() { return this.request('/api/v1/access/security'); }
    revokeAccessSession(id) { return this.request(`/api/v1/access/sessions/${encodeURIComponent(id)}`, { method:'DELETE' }); }

    inventoryBalances(filters = {}) { return this.request(`/api/v1/inventory${this.params(filters)}`); }
    inventoryLowStock() { return this.request('/api/v1/inventory/low-stock'); }
    inventoryMovements(filters = {}) { return this.request(`/api/v1/inventory/movements${this.params(filters)}`); }
    async saveInventoryMovement(body) {
      let payload = { ...body };
      if (payload.type === 'inventory-count' && payload.countedQuantity !== undefined) {
        const current = await this.request(`/api/v1/inventory/${encodeURIComponent(payload.productId)}`);
        payload.quantityDelta = Number((Number(payload.countedQuantity) - Number(current.quantity || 0)).toFixed(3));
        delete payload.countedQuantity;
      }
      return this.request('/api/v1/inventory/movements', { method:'POST', body:payload });
    }

    openCash(terminalId) { return this.request(`/api/v1/cash/open?terminalId=${encodeURIComponent(terminalId)}`); }
    createCash(body) { return this.request('/api/v1/cash/sessions', { method: 'POST', body, mutationId:this.mutationId() }); }
    cashAction(sessionId, action, body) { return this.request(`/api/v1/cash/sessions/${encodeURIComponent(sessionId)}/${action}`, { method: 'POST', body, mutationId:action === 'close' ? this.mutationId() : undefined }); }
    cashSessions(filters = {}) { return this.request(`/api/v1/cash/sessions${this.params(filters)}`); }
    cashMovements(sessionId) { return this.request(`/api/v1/cash/sessions/${encodeURIComponent(sessionId)}/movements`); }

    checkoutDocuments(query = '') { return this.request(`/api/v1/checkout/documents${this.params({query:query||undefined})}`); }
    openCheckoutDocument(type, id) { return this.request(`/api/v1/checkout/documents/${String(type||'').toLowerCase()}/${encodeURIComponent(id)}/open`, { method:'POST', body:{} }); }
    sales(status = '', limit = 50) { return this.request(`/api/v1/sales${this.params({status,limit})}`); }
    salesHistory(filters = {}) { return this.request(`/api/v1/sales/history${this.params(filters)}`); }
    sale(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}`); }
    saleDetails(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/details`); }
    openSale(body) { return this.request('/api/v1/sales', { method: 'POST', body }); }
    setSaleCustomer(id, customerId) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/customer`, { method: 'POST', body: { customerId } }); }
    setSaleSeller(id, sellerId) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/seller`, { method: 'POST', body: { sellerId } }); }
    addSaleItem(id, productId, quantity = 1) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items`, { method: 'POST', body: { productId, quantity } }); }
    updateSaleItem(id, productId, quantity) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items/${encodeURIComponent(productId)}`, { method: 'PUT', body: { quantity } }); }
    overrideSaleItemPrice(id, itemId, body) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/price`, { method: 'PUT', body }); }
    removeSaleItem(id, productId) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items/${encodeURIComponent(productId)}`, { method: 'DELETE' }); }
    discountSale(id, discountCents) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/discount`, { method: 'POST', body: { discountCents } }); }
    suspendSale(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/suspend`, { method: 'POST', body: {} }); }
    resumeSale(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/resume`, { method: 'POST', body: {} }); }
    completeSale(id, payments) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/complete`, { method: 'POST', body: { payments }, mutationId: this.mutationId() }); }
    cancelSale(id, reason) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason }, mutationId: this.mutationId() }); }

    returns(filters = {}) { return this.request(`/api/v1/returns${this.params(filters)}`); }
    returnDetails(id) { return this.request(`/api/v1/returns/${encodeURIComponent(id)}`); }
    createReturn(body) { return this.request('/api/v1/returns', { method:'POST', body, mutationId:this.mutationId() }); }
    cancelReturn(id, reason) { return this.request(`/api/v1/returns/${encodeURIComponent(id)}/cancel`, { method:'POST', body:{reason}, mutationId:this.mutationId() }); }

    financeAccounts(includeInactive = false) { return this.request(`/api/v1/finance/accounts${includeInactive ? '?includeInactive=true' : ''}`); }
    createFinanceAccount(body) { return this.request('/api/v1/finance/accounts', { method:'POST', body }); }
    financeEntries(filters = {}) { return this.request(`/api/v1/finance/entries${this.params(filters)}`); }
    financeEntry(id) { return this.request(`/api/v1/finance/entries/${encodeURIComponent(id)}`); }
    createFinanceEntry(body) { return this.request('/api/v1/finance/entries', { method:'POST', body }); }
    financeSummary(filters = {}) { return this.request(`/api/v1/finance/summary${this.params(filters)}`); }
    settleFinanceEntry(id, body) { return this.request(`/api/v1/finance/entries/${encodeURIComponent(id)}/settle`, { method:'POST', body }); }
    cancelFinanceEntry(id, reason) { return this.request(`/api/v1/finance/entries/${encodeURIComponent(id)}/cancel`, { method:'POST', body:{reason} }); }
    reverseFinanceSettlement(id, reason) { return this.request(`/api/v1/finance/settlements/${encodeURIComponent(id)}/reverse`, { method:'POST', body:{reason} }); }

    reportSales(filters = {}) { return this.request(`/api/v1/reports/sales${this.params(filters)}`); }
    reportSalesDetails(filters = {}) { return this.request(`/api/v1/reports/sales/details${this.params(filters)}`); }
    reportInventory() { return this.request('/api/v1/reports/inventory'); }
    reportCash(filters = {}) { return this.request(`/api/v1/reports/cash${this.params(filters)}`); }
    reportFinance(filters = {}) { return this.request(`/api/v1/reports/finance${this.params(filters)}`); }
    exportSalesCsv(filters = {}) { return this.request(`/api/v1/reports/sales.csv${this.params(filters)}`); }
    commissions(filters = {}) { return this.request(`/api/v1/commissions${this.params(filters)}`); }
    commissionRules(filters = {}) { return this.request(`/api/v1/commission-rules${this.params(filters)}`); }
    saveCommissionRule(body) { return this.request('/api/v1/commission-rules', { method:'POST', body }); }
    payCommission(body) { return this.request('/api/v1/commission-payments', { method:'POST', body }); }

    printJobs(filters = {}) { return this.request(`/api/v1/print/jobs${this.params(filters)}`); }
    retryPrint(id) { return this.request(`/api/v1/print/jobs/${encodeURIComponent(id)}/retry`, { method:'POST', body:{} }); }
    reprint(id) { return this.request(`/api/v1/print/jobs/${encodeURIComponent(id)}/reprint`, { method:'POST', body:{} }); }


    backupStatus() { return this.request('/api/v1/backups/status'); }
    backups() { return this.request('/api/v1/backups'); }
    createBackup(reason='manual') { return this.request('/api/v1/backups', { method:'POST', body:{reason} }); }
    validateBackup(id) { return this.request(`/api/v1/backups/${encodeURIComponent(id)}/validate`, { method:'POST', body:{} }); }
    prepareRestore(id) { return this.request(`/api/v1/backups/${encodeURIComponent(id)}/restore`, { method:'POST', body:{} }); }

    settings(filters={}) { return this.request(`/api/v1/settings${this.params(filters)}`); }
    saveSetting(key,value,scope='global') { return this.request(`/api/v1/settings/${encodeURIComponent(key)}`, { method:'PUT', body:{value,scope} }); }
    removeSetting(key,scope='global') { return this.request(`/api/v1/settings/${encodeURIComponent(key)}${this.params({scope})}`, { method:'DELETE' }); }

    importPreview(body) { return this.request('/api/v1/imports/preview', { method:'POST', body }); }
    importBatch(id) { return this.request(`/api/v1/imports/${encodeURIComponent(id)}`); }
    commitImport(id) { return this.request(`/api/v1/imports/${encodeURIComponent(id)}/commit`, { method:'POST', body:{} }); }

    audit(filters={}) { return this.request(`/api/v1/audit${this.params(filters)}`); }
    systemHealth() { return this.request('/api/v1/system/health'); }
    systemLogs(filters={}) { return this.request(`/api/v1/system/logs${this.params(filters)}`); }
    createDiagnostics() { return this.request('/api/v1/system/diagnostics', { method:'POST', body:{} }); }

    pilotChecks() { return this.request('/api/v1/pilot'); }
    pilotReadiness() { return this.request('/api/v1/pilot/readiness'); }
    updatePilotCheck(key,body) { return this.request(`/api/v1/pilot/${encodeURIComponent(key)}`, { method:'PATCH', body }); }
  }

  return { ApiClient };
});
