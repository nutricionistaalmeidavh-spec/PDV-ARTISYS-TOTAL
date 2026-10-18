// Storage location is an address/reference only, never a second inventory balance.
// Quantities still come exclusively from the immutable canonical stock ledger.
export function createStorageLocationsService({q,first,all,batch,applied,audit,stamp,branchExists,
 requiredMutation,error,text,randomId}){
 return {
  async storageLocations(tenant,branch){
   await branchExists(tenant,branch);
   return all(`SELECT l.id,l.code,l.name,
     COUNT(a.product_id) AS assignedProducts
     FROM inventory_storage_locations l
     LEFT JOIN inventory_product_location_assignments a
       ON a.tenant_id=l.tenant_id AND a.branch_id=l.branch_id AND a.location_id=l.id
     WHERE l.tenant_id=? AND l.branch_id=?
     GROUP BY l.id,l.code,l.name ORDER BY l.code,l.id LIMIT 200`,tenant,branch);
  },
  async createStorageLocation(tenant,branch,user,body,header){
   await branchExists(tenant,branch);
   const mutation=requiredMutation(body,header),scope='inventory.location.create:'+branch;
   const prior=await applied(tenant,scope,mutation);if(prior)return prior;
   const code=text(body?.code,32).toUpperCase(),name=text(body?.name,100);
   if(!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(code)||name.length<2)
     throw error(400,'Informe um código de localização válido e nome com ao menos dois caracteres.');
   if(await first('SELECT id FROM inventory_storage_locations WHERE tenant_id=? AND branch_id=? AND code=?',tenant,branch,code))
     throw error(409,'Este código de localização já existe na filial.');
   const result={id:randomId(),code,name,branchId:branch,assignedProducts:0};
   await batch([
     q('INSERT INTO inventory_storage_locations(id,tenant_id,branch_id,code,name,created_at) VALUES(?,?,?,?,?,?)',
      result.id,tenant,branch,code,name,stamp()),
     audit(tenant,scope,mutation,result)
   ]);
   return result;
  },
  async assignStorageLocation(tenant,branch,user,body,header){
   await branchExists(tenant,branch);
   const mutation=requiredMutation(body,header),scope='inventory.location.assign:'+branch;
   const prior=await applied(tenant,scope,mutation);if(prior)return prior;
   const productId=String(body?.productId||''),locationId=body?.locationId==null?null:String(body.locationId||'');
   const product=await first('SELECT id,track_stock AS trackStock FROM products WHERE tenant_id=? AND id=? AND active=1',tenant,productId);
   if(!product||!product.trackStock)throw error(404,'Produto ativo com estoque não encontrado nesta empresa.');
   if(locationId&&!await first('SELECT id FROM inventory_storage_locations WHERE tenant_id=? AND branch_id=? AND id=?',
     tenant,branch,locationId))throw error(404,'Localização não encontrada nesta filial.');
   const result={productId,locationId,branchId:branch,updatedAt:stamp()};
   await batch([
     locationId?q(`INSERT INTO inventory_product_location_assignments
       (tenant_id,branch_id,product_id,location_id,assigned_at,assigned_by)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(tenant_id,branch_id,product_id) DO UPDATE
       SET location_id=excluded.location_id,assigned_at=excluded.assigned_at,assigned_by=excluded.assigned_by`,
       tenant,branch,productId,locationId,result.updatedAt,user)
     :q('DELETE FROM inventory_product_location_assignments WHERE tenant_id=? AND branch_id=? AND product_id=?',
       tenant,branch,productId),
     audit(tenant,scope,mutation,result)
   ]);
   return result;
  }
 };
}
