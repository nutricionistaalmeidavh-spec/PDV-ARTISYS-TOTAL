// Portable compare-and-swap for the existing canonical product row.
// No second stock/catalog, no database-specific lock service or migration.
export const catalogFields=row=>[
 row.name,row.sku,row.sale_price_cents??row.salePriceCents,row.unit,Number(row.active),
 row.brand||'',row.barcode??null,row.category_id??row.categoryId??null,
 row.parent_product_id??row.parentProductId??null,row.variant_label??row.variantLabel??null,
 row.updated_at??row.updatedAt,Number(row.menu_enabled??row.menuEnabled??1),
 row.usage_type??row.usageType??'DIRECT'
];
export const catalogGuard=`name=? AND sku=? AND sale_price_cents=? AND unit=? AND active=?
 AND COALESCE(brand,'')=? AND barcode IS ? AND category_id IS ?
 AND parent_product_id IS ? AND variant_label IS ? AND updated_at=?
 AND menu_enabled=? AND usage_type=?`;
export const catalogGuardArgs=row=>catalogFields(row);
export async function catalogEditVersion(row){
 const data=new TextEncoder().encode(JSON.stringify(catalogFields(row)));
 const hash=await crypto.subtle.digest('SHA-256',data);
 return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
}
