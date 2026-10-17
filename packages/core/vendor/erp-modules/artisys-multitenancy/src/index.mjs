export function createTenantContext(value={}){if(!value.tenantId)throw new TypeError('tenantId is required');return{tenantId:String(value.tenantId),userId:value.userId==null?null:String(value.userId),roles:[...(value.roles??[])]}}
export function assertTenantAccess(context,tenantId){if(String(context?.tenantId)!==String(tenantId))throw new Error('tenant access denied');return true}
export function scopeRecord(context,record={}){return{...record,tenantId:String(context.tenantId)}}
export function filterTenantRecords(context,records=[]){return records.filter(r=>String(r.tenantId)===String(context.tenantId))}
