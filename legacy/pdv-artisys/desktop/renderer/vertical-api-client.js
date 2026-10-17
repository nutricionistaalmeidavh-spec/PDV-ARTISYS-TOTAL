'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const e=encodeURIComponent;
  const normalizeSale=sale=>{
    if(!sale||typeof sale!=='object'||Array.isArray(sale)||sale.manualDiscountCents==null)return sale;
    return {...sale,totalDiscountCents:sale.totalDiscountCents??sale.discountCents,discountCents:sale.manualDiscountCents};
  };
  const rememberSale=sale=>{
    const normalized=normalizeSale(sale);
    if(normalized&&normalized.manualDiscountCents!=null)window.PdvPromotionState={lastSale:normalized,rawSale:sale};
    return normalized;
  };
  Object.assign(ApiClient.prototype,{
    modules(){return this.request('/api/v1/vertical/modules');},
    setModule(id,enabled){return this.saveSetting(`modules.${String(id).toUpperCase()}.enabled`,Boolean(enabled),'global');},
    productConfiguration(productId){return this.request(`/api/v1/vertical/catalog/products/${e(productId)}/configuration`);},
    createOptionGroup(body){return this.request('/api/v1/vertical/catalog/option-groups',{method:'POST',body});},
    createOption(body){return this.request('/api/v1/vertical/catalog/options',{method:'POST',body});},
    createVariant(body){return this.request('/api/v1/vertical/catalog/variants',{method:'POST',body});},
    priceConfiguredItem(body){return this.request('/api/v1/vertical/catalog/price',{method:'POST',body});},
    kits(includeInactive=false){return this.request(`/api/v1/vertical/catalog/kits${includeInactive?'?includeInactive=true':''}`);},
    saveKit(body){return this.request('/api/v1/vertical/catalog/kits',{method:'POST',body});},
    promotionalCombos(includeInactive=false){return this.request(`/api/v1/vertical/catalog/promotional-combos${includeInactive?'?includeInactive=true':''}`);},
    savePromotionalCombo(body){return this.request('/api/v1/vertical/catalog/promotional-combos',{method:'POST',body});},
    saveRecipe(productId,body){return this.request(`/api/v1/vertical/recipes/${e(productId)}`,{method:'PUT',body});},
    recipe(productId){return this.request(`/api/v1/vertical/recipes/${e(productId)}`);},
    savePizzeriaProfile(body){return this.request('/api/v1/vertical/pizzeria/profile',{method:'POST',body});},
    savePizzeriaCatalog(body){return this.request('/api/v1/vertical/pizzeria/catalog',{method:'POST',body});},
    pizzeriaProfile(productId){return this.request(`/api/v1/vertical/pizzeria/products/${e(productId)}`);},
    pricePizza(body){return this.request('/api/v1/vertical/pizzeria/price',{method:'POST',body});},
    addConfiguredSaleItem(saleId,body){return this.request(`/api/v1/vertical/sales/${e(saleId)}/configured-item`,{method:'POST',body}).then(rememberSale);},
    updateConfiguredSaleItemQuantity(saleId,itemId,quantity){return this.request(`/api/v1/product-variants/sales/${e(saleId)}/items/${e(itemId)}`,{method:'PUT',body:{quantity}}).then(rememberSale);},
    removeConfiguredSaleItem(saleId,itemId){return this.request(`/api/v1/product-variants/sales/${e(saleId)}/items/${e(itemId)}`,{method:'DELETE'}).then(rememberSale);},
    restaurantRemaining(sessionId){return this.request(`/api/v1/vertical/restaurant/sessions/${e(sessionId)}/remaining`);},
    createRestaurantSettlement(sessionId,body){return this.request(`/api/v1/vertical/restaurant/sessions/${e(sessionId)}/settlements`,{method:'POST',body});},
    createRestaurantEqualSettlement(sessionId,body){return this.request(`/api/v1/vertical/restaurant/sessions/${e(sessionId)}/settlements/equal`,{method:'POST',body});},
    completeRestaurantSettlement(id,body){return this.request(`/api/v1/vertical/restaurant/settlements/${e(id)}/complete`,{method:'POST',body});},
    cancelRestaurantOrderItem(id,reason){return this.request(`/api/v1/vertical/restaurant/order-items/${e(id)}/cancel`,{method:'POST',body:{reason}});},
    mergeRestaurantSessions(sourceSessionId,targetSessionId){return this.request(`/api/v1/vertical/restaurant/sessions/${e(sourceSessionId)}/merge`,{method:'POST',body:{targetSessionId}});},
    transferRestaurantItems(sessionId,body){return this.request(`/api/v1/vertical/restaurant/sessions/${e(sessionId)}/transfer-items`,{method:'POST',body});},
    delivery(filters={}){return this.request(`/api/v1/vertical/delivery${this.params(filters)}`);},
    createDelivery(body){return this.request('/api/v1/vertical/delivery',{method:'POST',body,mutationId:this.mutationId()});},
    updateDeliveryStatus(id,status){return this.request(`/api/v1/vertical/delivery/${e(id)}/status`,{method:'PATCH',body:{status}});},
    cancelDelivery(id,reason){return this.request(`/api/v1/vertical/delivery/${e(id)}/cancel`,{method:'POST',body:{reason}});},
    assignDeliveryCourier(id,courier){return this.request(`/api/v1/vertical/delivery/${e(id)}/courier`,{method:'PATCH',body:{courier}});},
    createDeliverySale(id,body){return this.request(`/api/v1/vertical/delivery/${e(id)}/sale`,{method:'POST',body});},
    foodOrders(){return this.request('/api/v1/vertical/food/orders');},
    updateLegacyFoodOrderStatus(id,status){return this.request(`/api/v1/vertical/food/legacy-orders/${e(id)}/status`,{method:'PATCH',body:{status}});},
    fastFood(filters={}){return this.request(`/api/v1/vertical/fast-food${this.params(filters)}`);},
    createFastFood(body={}){return this.request('/api/v1/vertical/fast-food',{method:'POST',body,mutationId:this.mutationId()});},
    updateFastFoodStatus(id,status){return this.request(`/api/v1/vertical/fast-food/${e(id)}/status`,{method:'PATCH',body:{status}});},
    fastFoodReady(){return this.request('/api/v1/vertical/fast-food/ready');},
    priceWeighted(body){return this.request('/api/v1/vertical/catalog/weight/price',{method:'POST',body});},
    saveWeightProfile(body){return this.request('/api/v1/vertical/catalog/weight/profile',{method:'POST',body});},
    parseWeightBarcode(body){return this.request('/api/v1/vertical/catalog/weight/parse',{method:'POST',body});},
    addWeightedSaleItem(saleId,body){return this.request(`/api/v1/vertical/catalog/weight/sales/${e(saleId)}/items`,{method:'POST',body});},
    removeWeightedSaleItem(saleId,itemId){return this.request(`/api/v1/vertical/catalog/weight/sales/${e(saleId)}/items/${e(itemId)}`,{method:'DELETE'});},
    createBakeryOrder(body){return this.request('/api/v1/vertical/bakery/orders',{method:'POST',body});},
    bakeryOrder(id){return this.request(`/api/v1/vertical/bakery/orders/${e(id)}`);},
    updateBakeryOrderStatus(id,status){return this.request(`/api/v1/vertical/bakery/orders/${e(id)}/status`,{method:'PATCH',body:{status}});},
    cancelBakeryOrder(id,reason){return this.request(`/api/v1/vertical/bakery/orders/${e(id)}/cancel`,{method:'POST',body:{reason}});}
  });

  for(const name of ['sale','saleDetails','openSale','setSaleCustomer','addSaleItem','updateSaleItem','removeSaleItem','discountSale','suspendSale','resumeSale','completeSale','cancelSale']){
    const original=ApiClient.prototype[name];if(typeof original!=='function')continue;
    ApiClient.prototype[name]=async function(...args){return rememberSale(await original.apply(this,args));};
  }
  for(const name of ['sales','salesHistory']){
    const original=ApiClient.prototype[name];if(typeof original!=='function')continue;
    ApiClient.prototype[name]=async function(...args){const rows=await original.apply(this,args);return Array.isArray(rows)?rows.map(normalizeSale):rows;};
  }
})();
