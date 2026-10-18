'use strict';

(function attach(root, factory) {
  root.PdvApiClient = factory(root);
})(window, function factory(root) {
  // The ID is a nonsecret terminal identity. Keep it stable for this browser
  // installation; never let two different browser profiles share "WEB".
  function webTerminalIdentity(){
    const key='artisys.pdv.webTerminalId.v1';
    const store=root.localStorage;
    if(!store||typeof store.getItem!=='function'||typeof root.crypto?.randomUUID!=='function')
      throw new Error('Este navegador não suporta identificação segura e persistente do caixa.');
    let id=store.getItem(key);
    if(!id||!/^WEB-[a-f0-9-]{36}$/.test(id)){
      id='WEB-'+root.crypto.randomUUID();
      store.setItem(key,id);
    }
    return id;
  }
  // Shared browser context belongs to one client module, never to individual views.
  const browserContext={tenantId:null,branchId:null};
  class ApiClient {
    constructor() {
      this.webMode=!root.artisysDesktop;
      this.sessionToken=this.webMode?'':(root.sessionStorage?.getItem('artisys.sessionToken')||'');
      this.context=browserContext;
      this.completionKeys=new Map();
      this.config = null;
    }

    get tenantId(){return this.context.tenantId;}
    set tenantId(id){this.context.tenantId=id;}
    get branchId(){return this.context.branchId;}
    set branchId(id){this.context.branchId=id;}

    async initialize() {
      this.config = this.webMode ? {
        storeName:'PDV Total',terminalName:'Navegador',version:'Web',
        terminalId:webTerminalIdentity(),dataServer:{mode:'cloud',selected:true}
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
      let operation='',targetPath=original;
      const direct=['/api/v1/health','/api/v1/auth/login','/api/v1/auth/session','/api/v1/tenants'];
      if(!direct.includes(original)&&!original.startsWith('/api/v1/tenants/')){
        if(!this.tenantId||!this.branchId)throw new Error('Escolha o estabelecimento e a filial antes de continuar.');
        if(original==='/api/v1/products')operation='products';
        else if(original.startsWith('/api/v1/products/'))operation=original.slice(apiRoot.length);
        else if(original==='/api/v1/inventory')operation='inventory';
        else if(original==='/api/v1/inventory/movements')operation=method==='GET'?'inventory/movements':'inventory/receipts';
        else if(original==='/api/v1/inventory/adjustments')operation='inventory/adjustments';
        else if(original==='/api/v1/inventory/counts')operation='inventory/counts';
        else if(original==='/api/v1/inventory/lots')operation='inventory/lots';
        else if(original.startsWith('/api/v1/inventory/locations'))operation=original.slice(apiRoot.length);
        else if(original==='/api/v1/inventory/transfers')operation='inventory/transfers';
        else if(original.startsWith('/api/v1/inventory/reservations'))operation=original.slice(apiRoot.length);
        else if(original==='/api/v1/inventory/purchase-costs')operation='inventory/purchase-costs';
        else if(original==='/api/v1/inventory/receipts')operation='inventory/receipts';
        else if(original.startsWith('/api/v1/purchasing/'))operation=original.slice(apiRoot.length);
        else if(original==='/api/v1/cash/open')operation='cash';
        else if(original==='/api/v1/cash/sessions')operation=method==='POST'?'cash/open':'cash/sessions';
        else if(original.startsWith('/api/v1/cash/sessions/'))operation=original.slice(apiRoot.length);
        else if(original.startsWith('/api/v1/finance/'))operation=original.slice(apiRoot.length);
        else if(original.startsWith('/api/v1/finance-advanced/'))operation=original.slice(apiRoot.length);
        else if(original.startsWith('/api/v1/reports/'))operation=original.slice(apiRoot.length);
        else if(original.startsWith('/api/v1/sales'))operation=original.slice(apiRoot.length);
        else if(original==='/api/v1/returns')operation='returns';
        else if(/^\/api\/v1\/(customers|suppliers|sellers|restaurant|wholesale|commissions|credit)(\/|$)/.test(original))operation=original.slice(apiRoot.length);
        else throw new Error('Este módulo ainda não está disponível na versão online.');
        targetPath=apiRoot+'tenants/'+encodeURIComponent(this.tenantId)+'/'+operation;
        if(method==='GET'||method==='DELETE')url.searchParams.set('branchId',this.branchId);
      }
      const target=new URL(targetPath,root.location.origin);
      for(const [k,v] of url.searchParams)target.searchParams.set(k,v);
      const headers={'accept':'application/json'};
      // In self-hosted LAN, the server enforces this device credential on
      // every business route; a revoked terminal cannot continue selling.
      if(this.tenantId&&target.pathname.startsWith('/api/v1/tenants/')){
        const deviceKey='pdv-total-r2-device-'+this.tenantId;
        const deviceId=root.localStorage?.getItem(deviceKey+'-id');
        const credential=root.localStorage?.getItem(deviceKey+'-credential');
        if(deviceId&&credential){
          headers['x-pdv-device-id']=deviceId;
          headers['x-pdv-device-credential']=credential;
        }
      }
      if(!['GET','HEAD'].includes(method))headers['content-type']='application/json';
      const payload=body==null?{}:{...body};
      if(!['GET','HEAD'].includes(method)){
        if(operation)payload.branchId=this.branchId;
        if((/^sales\/[^/]+\/(returns|cancel)$/.test(operation)||/^credit\/[^/]+\/payments$/.test(operation))&&!payload.terminalId)
          payload.terminalId=this.config?.terminalId||webTerminalIdentity();
        let key=mutationId;
        const completion=/^sales\/[^/]+\/complete$/.test(operation);
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
      const isCsv=response.headers.get('content-type')?.includes('text/csv');
      let value;try{value=isCsv?await response.text():await response.json();}catch{value={};}
      if(!response.ok){
        const e=new Error(value.error||'Não foi possível concluir a operação.');
        e.status=response.status;
        throw e;
      }
      if(/^sales\/[^/]+\/complete$/.test(operation))this.completionKeys.delete(operation);
      if(operation==='products')return method==='GET'?value.products:value.product;
      if(operation==='products/categories')return method==='GET'?value.categories:value.category;
      if(/^products\/categories\/[^/]+$/.test(operation))return value.category;
      if(/^products\/[^/]+\/configuration$/.test(operation))return value.configuration;
      if(/^products\/[^/]+\/configuration\/price$/.test(operation))return value.quote;
      if(operation==='products/import/preview')return value.preview;
      if(operation==='products/import/commit')return value.result;
      if(/^products\/[^/]+\/bundle$/.test(operation))return method==='GET'?value.components:value.bundle;
      if(operation.startsWith('products/'))return value.product;
      if(operation==='customers')return method==='GET'?value.customers:value.customer;
      if(operation==='suppliers')return method==='GET'?value.suppliers:value.supplier;
      if(operation==='sellers')return value.sellers;
      if(operation.startsWith('restaurant/')||operation.startsWith('wholesale/')||operation.startsWith('commissions')||operation.startsWith('credit/'))return value;
      if(operation==='inventory')return value.stock;
      if(operation==='inventory/receipts'||operation==='inventory/adjustments')return value.movement;
      if(operation==='inventory/movements')return value.movements;
      if(operation==='inventory/counts')return value.count;
      if(operation==='inventory/lots')return value.lots;
      if(operation==='inventory/transfers')return method==='GET'?value.transfers:value.transfer;
      if(operation==='inventory/reservations')return method==='GET'?value.reservations:value.reservation;
      if(/^inventory\/reservations\/[^/]+\/release$/.test(operation))return value.reservation;
      if(operation==='inventory/purchase-costs')return value.costs;
      if(operation==='purchasing/orders')return method==='GET'?value.orders:value.order;
      if(operation==='purchasing/cost-averages')return value.averages;
      if(/^purchasing\/orders\/[^/]+\/receive$/.test(operation))return value.receipt;
      if(operation.startsWith('purchasing/orders/'))return value.order;
      if(operation==='cash')return value.session;
      if(operation==='cash/open')return {session:value.session};
      if(operation==='cash/sessions')return value.sessions;
      if(operation==='cash/sessions/search')return value.history;
      if(operation.startsWith('cash/sessions/'))return operation.endsWith('/movements')?value.movements:value.result;
      if(/^sales\/[^/]+\/(customer|seller)$/.test(operation))return value.sale;
      if(/^sales\/[^/]+\/items\/configured$/.test(operation))return value.sale;
      if(operation==='finance/summary')return value.summary;
      if(operation==='finance/entries')return method==='GET'?value.entries:value.entry;
      if(operation.startsWith('finance/entries/'))return value.settlement||value.result||value.entry;
      if(operation==='reports/summary')return value.report;
      if(operation==='reports/commission-ranking')return value.ranking;
      if(operation==='reports/commission-targets')return value.target;
      if(operation==='reports/compare')return value.comparison;
      if(operation==='reports/daily-trend')return value.trend;
      if(operation==='reports/margins')return value.margin;
      if(operation==='reports/details')return value.details;
      if(operation==='reports/stock-coverage')return value.coverage;
      if(operation==='reports/home')return value.home;
      if(operation==='reports/sales.csv')return value;
      if(operation==='sales'||operation.startsWith('sales?'))return method==='GET'?value.sales:value.sale;
      if(operation==='sales/history')return value.history;
      if(operation==='returns')return method==='GET'?value.returns:value.return;
      if(/^sales\/[^/]+\/returns\/quote$/.test(operation))return value.quote;
      if(/^sales\/[^/]+\/returns$/.test(operation))return method==='GET'?value.returns:value.result;
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
    async logout() { if(this.webMode){ const result=await this.webRequest('/api/v1/auth/session',{method:'DELETE'});this.completionKeys.clear();this.tenantId=null;this.branchId=null;return result; } this.sessionToken = ''; root.sessionStorage?.removeItem('artisys.sessionToken'); }
    currentSession() { return this.request('/api/v1/auth/session'); }
    authorizeReturn(body) { return this.request('/api/v1/auth/authorize', { method:'POST', body }); }

    categories(includeInactive = false) { return this.request(this.webMode?'/api/v1/products/categories':`/api/v1/categories${includeInactive ? '?includeInactive=true' : ''}`); }
    saveCategory(body) { return this.request(this.webMode?'/api/v1/products/categories':'/api/v1/categories', { method: 'POST', body }); }
    renameCategory(id,name,mutationId){return this.request('/api/v1/products/categories/'+encodeURIComponent(id),{method:'PATCH',body:{name},mutationId});}
    previewCatalogCsv(csv,mode='create'){return this.request('/api/v1/products/import/preview',{method:'POST',body:{csv,mode}});}
    commitCatalogCsv(csv,mutationId,mode='create',previewToken=null){
      return this.request('/api/v1/products/import/commit',{method:'POST',body:{csv,mode,...(previewToken?{previewToken}:{})},mutationId});
    }
    products(includeInactive = false) { return this.request(`/api/v1/products${includeInactive ? '?includeInactive=true' : ''}`); }
    saveProduct(body,mutationId) { return this.request('/api/v1/products', { method: 'POST', body,mutationId }); }
    updateProduct(id,body,mutationId) { return this.request(`/api/v1/products/${encodeURIComponent(id)}`, { method:'PATCH', body,mutationId }); }
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

    webProductPhotoUrl(id){
      if(!this.webMode||!this.tenantId||!this.branchId)throw new Error('Selecione a empresa e a filial.');
      return '/api/v1/tenants/'+encodeURIComponent(this.tenantId)+'/products/'+encodeURIComponent(id)+
        '/photo?branchId='+encodeURIComponent(this.branchId);
    }
    async uploadWebProductPhoto(id,file,mutationId=this.mutationId()){
      if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152)
        throw new Error('Selecione JPEG, PNG ou WebP com até 2 MB.');
      let response;
      try{response=await root.fetch(this.webProductPhotoUrl(id),{
        method:'PUT',credentials:'same-origin',redirect:'error',
        headers:{'content-type':file.type,'x-mutation-id':mutationId},body:file
      });}catch{throw new Error('Não foi possível enviar a imagem. Confira a conexão.');}
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw Object.assign(new Error(payload.error||'Falha ao salvar a imagem.'),{status:response.status});
      return payload;
    }
    async removeWebProductPhoto(id,mutationId=this.mutationId()){
      let response;
      try{response=await root.fetch(this.webProductPhotoUrl(id),{
        method:'DELETE',credentials:'same-origin',redirect:'error',
        headers:{'x-mutation-id':mutationId}
      });}catch{throw new Error('Não foi possível remover a foto. Confira a conexão.');}
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw Object.assign(new Error(payload.error||'Falha ao remover a imagem.'),{status:response.status});
      return payload;
    }
    productBundle(id){return this.request('/api/v1/products/'+encodeURIComponent(id)+'/bundle');}
    saveProductBundle(id,components,mutationId){return this.request('/api/v1/products/'+encodeURIComponent(id)+'/bundle',{method:'POST',body:{components},mutationId});}
    stockReservations(filters={}){return this.request('/api/v1/inventory/reservations'+this.params(filters));}
    reserveStock(body,mutationId){return this.request('/api/v1/inventory/reservations',{method:'POST',body,mutationId});}
    releaseStockReservation(id,mutationId){return this.request('/api/v1/inventory/reservations/'+encodeURIComponent(id)+'/release',{method:'POST',body:{},mutationId});}
    purchaseCostHistory(filters={}){return this.request('/api/v1/inventory/purchase-costs'+this.params(filters));}
    purchaseReceipt(body,mutationId){return this.request('/api/v1/inventory/receipts',{method:'POST',body,mutationId});}
    purchaseOrders(){return this.request('/api/v1/purchasing/orders');}
    createPurchaseOrder(body,mutationId){return this.request('/api/v1/purchasing/orders',{method:'POST',body,mutationId});}
    purchaseOrder(id){return this.request('/api/v1/purchasing/orders/'+encodeURIComponent(id));}
    receivePurchaseOrder(id,items,mutationId){return this.request('/api/v1/purchasing/orders/'+encodeURIComponent(id)+'/receive',{method:'POST',body:{items},mutationId});}
    cancelPurchaseOrder(id,reason,mutationId){return this.request('/api/v1/purchasing/orders/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:{reason},mutationId});}
    purchaseCostAverages(filters={}){return this.request('/api/v1/purchasing/cost-averages'+this.params(filters));}
    storageLocations(){return this.request('/api/v1/inventory/locations').then(result=>result.locations);}
    storageAssignments(){return this.request('/api/v1/inventory/locations/assign').then(result=>result.assignments);}
    createStorageLocation(body,mutationId=this.mutationId()){
      return this.request('/api/v1/inventory/locations',{method:'POST',body,mutationId}).then(result=>result.location);
    }
    assignStorageLocation(body,mutationId=this.mutationId()){
      return this.request('/api/v1/inventory/locations/assign',{method:'POST',body,mutationId}).then(result=>result.assignment);
    }
    inventoryBalances(filters = {}) { return this.request(`/api/v1/inventory${this.params(filters)}`); }
    inventoryLowStock() { return this.request('/api/v1/inventory/low-stock'); }
    inventoryMovements(filters = {}) { return this.request(`/api/v1/inventory/movements${this.params(filters)}`); }
    inventoryAdjust(body,mutationId=this.mutationId()){return this.request('/api/v1/inventory/adjustments',{method:'POST',body,mutationId});}
    inventoryReceipt(body,mutationId=this.mutationId()){return this.request('/api/v1/inventory/receipts',{method:'POST',body,mutationId});}
    inventoryCount(body,mutationId=this.mutationId()){return this.request('/api/v1/inventory/counts',{method:'POST',body,mutationId});}
    inventoryLotReceipts(filters={}){return this.request('/api/v1/inventory/lots'+this.params(filters));}
    stockTransfers(filters = {}) { return this.request(`/api/v1/inventory/transfers${this.params(filters)}`); }
    transferStock(body,mutationId) { return this.request('/api/v1/inventory/transfers',{method:'POST',body,mutationId}); }
    tenantBranches(){if(!this.webMode||!this.tenantId)throw new Error('Selecione o estabelecimento.');return this.webRequest('/api/v1/tenants/'+encodeURIComponent(this.tenantId)+'/branches');}
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
    createCash(body,mutationId=this.mutationId()) { return this.request('/api/v1/cash/sessions', { method: 'POST', body, mutationId }); }
    async cashAction(sessionId, action, body) {
      if(!this.webMode)return this.request(`/api/v1/cash/sessions/${encodeURIComponent(sessionId)}/${action}`,{method:'POST',body,mutationId:action==='close'?this.mutationId():undefined});
      const scope='cash/'+sessionId+'/'+action;
      let key=this.completionKeys.get(scope);
      if(!key){key=this.mutationId();this.completionKeys.set(scope,key);}
      try{
        const result=await this.request(`/api/v1/cash/sessions/${encodeURIComponent(sessionId)}/${action}`,{method:'POST',body,mutationId:key});
        this.completionKeys.delete(scope);return result;
      }catch(error){if(error.status&&error.status!==503)this.completionKeys.delete(scope);throw error;}
    }
    cashSessions(filters = {}) { return this.request(`/api/v1/cash/sessions${this.params(filters)}`); }
    cashSessionsSearch(filters = {}) { return this.request(`/api/v1/cash/sessions/search${this.params(filters)}`); }
    cashMovements(sessionId) { return this.request(`/api/v1/cash/sessions/${encodeURIComponent(sessionId)}/movements`); }

    checkoutDocuments(query = '') { return this.request(`/api/v1/checkout/documents${this.params({query:query||undefined})}`); }
    openCheckoutDocument(type, id) { return this.request(`/api/v1/checkout/documents/${String(type||'').toLowerCase()}/${encodeURIComponent(id)}/open`, { method:'POST', body:{} }); }
    sales(status = '', limit = 50) { return this.request(`/api/v1/sales${this.params({status,limit})}`); }
    salesHistory(filters = {}) { return this.request(`/api/v1/sales/history${this.params(filters)}`); }
    compareSalesPeriods(filters = {}) { return this.request(`/api/v1/reports/compare${this.params(filters)}`); }
    dailySalesTrend(filters={}){return this.request('/api/v1/reports/daily-trend'+this.params(filters));}
    sellerSalesRanking(filters={}){return this.request('/api/v1/reports/commission-ranking'+this.params(filters));}
    saveSellerSalesTarget(body,mutationId){return this.request('/api/v1/reports/commission-targets',{method:'PUT',body,mutationId});}
    historicalMarginReport(filters = {}) { return this.request(`/api/v1/reports/margins${this.params(filters)}`); }
    reportSalesDetailsCanonical(filters={}){return this.request('/api/v1/reports/details'+this.params(filters));}
    exportSalesDetailCsvCanonical(filters={}){return this.request('/api/v1/reports/details.csv'+this.params(filters));}
    reportStockCoverage(filters={}){return this.request('/api/v1/reports/stock-coverage'+this.params(filters));}
    setStockMinimum(productId,minimumQuantity,mutationId){return this.request('/api/v1/reports/stock-minimum',{method:'PUT',body:{productId,minimumQuantity},mutationId});}
    homeIndicators(filters={}){return this.request('/api/v1/reports/home'+this.params(filters));}
    sale(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}`); }
    saleDetails(id) { return this.webMode?this.sale(id):this.request(`/api/v1/sales/${encodeURIComponent(id)}/details`); }
    openSale(body,mutationId) { return this.request('/api/v1/sales', { method: 'POST', body,mutationId }); }
    setSaleCustomer(id, customerId) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/customer`, { method: 'POST', body: { customerId } }); }
    setSaleSeller(id, sellerId) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/seller`, { method: 'POST', body: { sellerId } }); }
    addSaleItem(id, productId, quantity = 1) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items`, { method: 'POST', body: { productId, quantity } }); }
    updateSaleItem(id, productId, quantity) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items/${encodeURIComponent(productId)}`, { method: 'PUT', body: { quantity }, mutationId: this.mutationId() }); }
    overrideSaleItemPrice(id, itemId, body) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/price`, { method: 'PUT', body }); }
    setSaleItemNote(id,itemId,note,mutationId=this.mutationId()){return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/note`,{method:'PUT',body:{note},mutationId});}
    removeSaleItem(id, productId) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items/${encodeURIComponent(productId)}`, { method: 'DELETE', mutationId: this.mutationId() }); }
    discountSale(id, discountCents) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/discount`, { method: 'POST', body: { discountCents }, mutationId: this.mutationId() }); }
    suspendSale(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/suspend`, { method: 'POST', body: {}, mutationId: this.mutationId() }); }
    resumeSale(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/resume`, { method: 'POST', body: {}, mutationId: this.mutationId() }); }
    completeSale(id, payments) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/complete`, { method: 'POST', body: { payments }, mutationId: this.mutationId() }); }
    cancelSale(id, reason) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason }, mutationId: this.mutationId() }); }

    returns(filters = {}) { return this.request(`/api/v1/returns${this.params(filters)}`); }
    returnDetails(id) { return this.request(`/api/v1/returns/${encodeURIComponent(id)}`); }
    createReturn(body,mutationId) { return this.request('/api/v1/returns', { method:'POST', body, mutationId:mutationId||this.mutationId() }); }
    quoteSaleReturn(saleId,body){return this.request(`/api/v1/sales/${encodeURIComponent(saleId)}/returns/quote`,{method:'POST',body});}
    saleReturns(saleId){return this.request(`/api/v1/sales/${encodeURIComponent(saleId)}/returns`);}
    cancelReturn(id, reason) { return this.request(`/api/v1/returns/${encodeURIComponent(id)}/cancel`, { method:'POST', body:{reason}, mutationId:this.mutationId() }); }

    financeAccounts(includeInactive = false) { return this.request(`/api/v1/finance/accounts${includeInactive ? '?includeInactive=true' : ''}`); }
    createFinanceAccount(body) { return this.request('/api/v1/finance/accounts', { method:'POST', body }); }
    financeEntries(filters = {}) { return this.request(`/api/v1/finance/entries${this.params(filters)}`); }
    financeEntry(id) { return this.request(`/api/v1/finance/entries/${encodeURIComponent(id)}`); }
    createFinanceEntry(body,mutationId) { return this.request('/api/v1/finance/entries', { method:'POST', body,mutationId }); }
    financeSummary(filters = {}) { return this.request(`/api/v1/finance/summary${this.params(filters)}`); }
    settleFinanceEntry(id, body,mutationId) { return this.request(`/api/v1/finance/entries/${encodeURIComponent(id)}/settle`, { method:'POST', body,mutationId }); }
    cancelFinanceEntry(id, reason,mutationId) { return this.request(`/api/v1/finance/entries/${encodeURIComponent(id)}/cancel`, { method:'POST', body:{reason},mutationId }); }
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
