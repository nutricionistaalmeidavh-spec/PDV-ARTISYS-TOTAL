// Project individual configured choices without creating duplicate catalog products
// or replacing the historical sale_items ID referenced by financial/stock ledgers.
export async function pricedSaleLines(all,tenant,branch,saleId,parents){
 const choices=await all(`SELECT * FROM sale_configured_lines
   WHERE tenant_id=? AND branch_id=? AND sale_id=? ORDER BY created_at,id`,tenant,branch,saleId);
 const grouped=new Map();
 for(const c of choices){
   if(!grouped.has(c.sale_item_id))grouped.set(c.sale_item_id,[]);
   grouped.get(c.sale_item_id).push(c);
 }
 return parents.flatMap(p=>{
   const child=grouped.get(p.id);
   if(!child?.length)return [p];
   return child.map(c=>({
     ...p,id:c.id,parent_item_id:p.id,configured_line_id:c.id,
     quantity_milli:c.quantity_milli,unit_price_cents:c.unit_price_cents,
     catalog_unit_price_cents:c.catalog_unit_price_cents,
     configuration_json:c.configuration_json,note:c.note,created_at:c.created_at
   }));
 });
}
