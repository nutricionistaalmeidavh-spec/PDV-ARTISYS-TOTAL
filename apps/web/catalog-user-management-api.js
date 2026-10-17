'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const p=ApiClient.prototype;
  p.removeCategory=function(categoryId){return this.request(`/api/v1/categories/${encodeURIComponent(categoryId)}`,{method:'DELETE'});};
  p.removeCustomer=function(customerId){return this.request(`/api/v1/customers/${encodeURIComponent(customerId)}`,{method:'DELETE'});};
  p.removeSupplier=function(supplierId){return this.request(`/api/v1/suppliers/${encodeURIComponent(supplierId)}`,{method:'DELETE'});};
  p.removeUser=function(userId){return this.request(`/api/v1/users/${encodeURIComponent(userId)}`,{method:'DELETE'});};
})();
