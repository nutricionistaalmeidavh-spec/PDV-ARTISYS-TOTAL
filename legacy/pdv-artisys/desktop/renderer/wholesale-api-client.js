'use strict';

(()=>{
  const ApiClient=window.PdvApiClient?.ApiClient;if(!ApiClient)return;
  const p=ApiClient.prototype;const e=encodeURIComponent;
  p.wholesaleTiers=function(productId=null,includeInactive=false){return this.request(`/api/v1/wholesale/tiers${this.params({productId:productId||undefined,includeInactive:includeInactive||undefined})}`);};
  p.saveWholesaleTier=function(body){return this.request('/api/v1/wholesale/tiers',{method:'POST',body});};
  p.deactivateWholesaleTier=function(id){return this.request(`/api/v1/wholesale/tiers/${e(id)}`,{method:'DELETE'});};
  p.wholesalePrice=function(productId,quantity){return this.request(`/api/v1/wholesale/price${this.params({productId,quantity})}`);};
  p.wholesaleCustomerPolicy=function(customerId){return this.request(`/api/v1/wholesale/customers/${e(customerId)}/policy`);};
  p.saveWholesaleCustomerPolicy=function(customerId,body){return this.request(`/api/v1/wholesale/customers/${e(customerId)}/policy`,{method:'PUT',body});};
    p.wholesaleOrders=function(filters={}){return this.request(`/api/v1/wholesale/orders${this.params(filters)}`);};
  p.wholesaleOrder=function(id){return this.request(`/api/v1/wholesale/orders/${e(id)}`);};
  p.createWholesaleQuote=function(body){return this.request('/api/v1/wholesale/orders',{method:'POST',body});};
  p.confirmWholesaleOrder=function(id){return this.request(`/api/v1/wholesale/orders/${e(id)}/confirm`,{method:'POST',body:{}});};
  p.cancelWholesaleOrder=function(id,reason){return this.request(`/api/v1/wholesale/orders/${e(id)}/cancel`,{method:'POST',body:{reason}});};
  p.fulfillWholesaleOrder=function(id,body){return this.request(`/api/v1/wholesale/orders/${e(id)}/fulfill`,{method:'POST',body:{...body,idempotencyKey:body.idempotencyKey||this.mutationId()}});};
})();
