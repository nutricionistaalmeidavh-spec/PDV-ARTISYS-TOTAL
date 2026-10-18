import {createCommerceService,commerceError} from './commerce.mjs';
import canonicalAuthorization from '../../../packages/core/js/core/auth/authorization-service.js';
import canonicalProfiles from '../../../packages/core/js/core/auth/default-profiles.js';

const {createAuthorizationService}=canonicalAuthorization;
const {DEFAULT_PROFILE_PERMISSIONS}=canonicalProfiles;
const writeMethods=new Set(['POST','PUT','PATCH','DELETE']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
const fail=(status,message)=>json({error:message},status);

async function payload(request){
  const length=Number(request.headers.get('content-length')||0);
  if(length>16384)throw Object.assign(new Error('Pedido muito grande.'),{status:413});
  if(!String(request.headers.get('content-type')||'').includes('application/json'))
    throw Object.assign(new Error('Envie dados em JSON.'),{status:415});
  const raw=await request.text();
  if(raw.length>16384)throw Object.assign(new Error('Pedido muito grande.'),{status:413});
  let body;try{body=JSON.parse(raw);}catch{}
  if(!body||Array.isArray(body)||typeof body!=='object')
    throw Object.assign(new Error('Dados inválidos.'),{status:400});
  return body;
}
function can(profileKey,capability,userId){
  const key=profileKey==='OWNER'?'ADMINISTRATOR':profileKey;
  return createAuthorizationService({
    resolvePermissions:()=>DEFAULT_PROFILE_PERMISSIONS[key]||[]
  }).can({principal:{kind:'human',id:userId},capability});
}
const requireAccess=(membership,capability,userId)=>{
  if(!can(membership.profileKey,capability,userId))
    throw Object.assign(new Error('Permissão insuficiente.'),{status:403});
};
export async function commerceRoute(request,db,session,member,tenantId,path,{now}={}){
  const url=new URL(request.url),method=request.method;
  const parts=path.split('/').filter(Boolean);
  const feature=parts[0];
  const key=request.headers.get('x-mutation-id');
  try {
    if(!['products','inventory','purchasing','cash','sales','finance','reports','returns'].includes(feature))return null;
    const body=writeMethods.has(method) ? (method==='DELETE'&&!request.headers.has('content-type')?{}:await payload(request)) : {};
    if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method))return null;
    const branch=body.branchId||url.searchParams.get('branchId');
    const service=createCommerceService(db,{now});
    if(!branch)throw Object.assign(new Error('Selecione a filial antes de continuar.'),{status:400});
    const tenant=tenantId,user=session.userId;
    if(feature==='returns'){
      if(parts.length!==1)return null;
      if(method==='GET'){
        requireAccess(member,'sales.view',user);
        return json({returns:await service.allSaleReturns(tenant,branch)});
      }
      if(method==='POST'){
        requireAccess(member,'sales.cancel',user);
        if(typeof body.saleId!=='string'||!body.saleId||body.saleId.length>128)
          throw Object.assign(new Error('Venda inválida.'),{status:400});
        return json({return:await service.returnSale(tenant,branch,body.saleId,user,body,key)},201);
      }
      return null;
    }
    if(feature==='products'){
      if(parts.length===3&&parts[1]==='import'&&method==='POST'){
        requireAccess(member,'products.manage',user);
        if(parts[2]==='preview')
          return json({preview:await service.previewCatalogImport(tenant,branch,body)});
        if(parts[2]==='commit')
          return json({result:await service.commitCatalogImport(tenant,branch,user,body,key)},201);
      }
      if(parts[1]==='categories'&&parts.length===2){
        if(method==='GET'){requireAccess(member,'products.view',user);return json({categories:await service.categories(tenant,branch)});}
        if(method==='POST'){requireAccess(member,'products.manage',user);return json({category:await service.createCategory(tenant,branch,user,body,key)},201);}
      }
      if(parts[1]==='categories'&&parts.length===3&&method==='PATCH'){
        requireAccess(member,'products.manage',user);
        return json({category:await service.renameCategory(tenant,branch,user,parts[2],body,key)});
      }
      if(parts.length===3&&parts[2]==='configuration'){
        if(method==='GET'){
          requireAccess(member,'products.view',user);
          return json({configuration:await service.checkoutProductConfiguration(tenant,branch,parts[1])});
        }
        if(method==='PUT'){
          requireAccess(member,'products.manage',user);
          return json({configuration:await service.saveCheckoutProductConfiguration(tenant,branch,parts[1],body,key)});
        }
      }
      if(parts.length===4&&parts[2]==='configuration'&&parts[3]==='price'&&method==='POST'){
        requireAccess(member,'products.view',user);
        return json({quote:await service.priceCheckoutProductConfiguration(tenant,branch,parts[1],body)});
      }
      if(parts.length===3&&parts[2]==='bundle'){
        if(method==='GET'){requireAccess(member,'products.view',user);return json({components:await service.productBundle(tenant,branch,parts[1])});}
        if(method==='POST'){requireAccess(member,'products.manage',user);return json({bundle:await service.setBundle(tenant,branch,parts[1],user,body,key)});}
      }
      if(parts.length===2&&parts[1].length<=128&&method==='PATCH'){
        requireAccess(member,'products.manage',user);
        return json({product:await service.updateProduct(tenant,branch,parts[1],body,key)});
      }
      if(parts.length!==1)return null;
      if(method==='GET'){
        const includeInactive=url.searchParams.get('includeInactive')==='true';
        requireAccess(member,includeInactive?'products.manage':'products.view',user);
        return json({products:await service.products(tenant,branch,{limit:100,includeInactive})});
      }
      if(method==='POST'){
        requireAccess(member,'products.manage',user);
        return json({product:await service.createProduct(tenant,user,body,key)},201);
      }
    }
    if(feature==='purchasing'){
      if(parts.length===2&&parts[1]==='orders'){
        if(method==='GET'){
          requireAccess(member,'inventory.view',user);
          return json({orders:await service.purchaseOrders(tenant,branch)});
        }
        if(method==='POST'){
          requireAccess(member,'inventory.adjust',user);
          return json({order:await service.createPurchaseOrder(tenant,branch,user,body,key)},201);
        }
      }
      if(parts.length===3&&parts[1]==='orders'&&parts[2].length<=128&&method==='GET'){
        requireAccess(member,'inventory.view',user);
        return json({order:await service.purchaseOrder(tenant,branch,parts[2])});
      }
      if(parts.length===4&&parts[1]==='orders'&&parts[2].length<=128&&method==='POST'){
        requireAccess(member,'inventory.adjust',user);
        if(parts[3]==='receive')
          return json({receipt:await service.receivePurchaseOrder(tenant,branch,parts[2],user,body,key)},201);
        if(parts[3]==='cancel')
          return json({order:await service.cancelPurchaseOrder(tenant,branch,parts[2],user,body,key)});
      }
      if(parts.length===2&&parts[1]==='cost-averages'&&method==='GET'){
        requireAccess(member,'inventory.view',user);
        return json({averages:await service.purchaseCostSummary(tenant,branch,{productId:url.searchParams.get('productId')||null})});
      }
      return null;
    }
    if(feature==='inventory'){
      if(parts[1]==='locations'&&parts.length===2){
        if(method==='GET'){
          requireAccess(member,'inventory.view',user);
          return json({locations:await service.storageLocations(tenant,branch)});
        }
        if(method==='POST'){
          requireAccess(member,'inventory.adjust',user);
          return json({location:await service.createStorageLocation(tenant,branch,user,body,key)},201);
        }
      }
      if(parts[1]==='locations'&&parts[2]==='assign'&&parts.length===3&&method==='GET'){
        requireAccess(member,'inventory.view',user);
        return json({assignments:await service.storageAssignments(tenant,branch)});
      }
      if(parts[1]==='locations'&&parts[2]==='assign'&&parts.length===3&&method==='POST'){
        requireAccess(member,'inventory.adjust',user);
        return json({assignment:await service.assignStorageLocation(tenant,branch,user,body,key)});
      }
      if(parts[1]==='lots'&&parts.length===2&&method==='GET'){
        requireAccess(member,'inventory.view',user);
        return json({lots:await service.lotReceipts(tenant,branch,{
          productId:url.searchParams.get('productId')||'',
          limit:url.searchParams.get('limit')||50
        })});
      }
      if(parts[1]==='reservations'&&parts.length===2){
        if(method==='GET'){requireAccess(member,'inventory.view',user);return json({reservations:await service.stockReservations(tenant,branch,{productId:url.searchParams.get('productId')||null})});}
        if(method==='POST'){requireAccess(member,'inventory.adjust',user);return json({reservation:await service.reserveStock(tenant,branch,user,body,key)},201);}
      }
      if(parts[1]==='reservations'&&parts.length===4&&parts[3]==='release'&&method==='POST'){
        requireAccess(member,'inventory.adjust',user);
        return json({reservation:await service.releaseReservation(tenant,branch,parts[2],user,key)});
      }
      if(parts[1]==='purchase-costs'&&parts.length===2&&method==='GET'){
        requireAccess(member,'inventory.view',user);
        return json({costs:await service.purchaseCosts(tenant,branch,{productId:url.searchParams.get('productId')||null})});
      }
      if(parts[1]==='transfers'&&parts.length===2&&method==='GET'){
        requireAccess(member,'inventory.view',user);
        return json({transfers:await service.stockTransfers(tenant,branch,{limit:url.searchParams.get('limit')||50})});
      }
      if(parts[1]==='transfers'&&parts.length===2&&method==='POST'){
        requireAccess(member,'inventory.adjust',user);
        return json({transfer:await service.transferStock(tenant,branch,user,body,key)},201);
      }
      if(parts[1]==='movements'&&parts.length===2&&method==='GET'){
        requireAccess(member,'inventory.view',user);
        return json({movements:await service.inventoryMovements(tenant,branch,{
          productId:url.searchParams.get('productId')||'',type:url.searchParams.get('type')||'',
          from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||'',
          limit:url.searchParams.get('limit')||100,offset:url.searchParams.get('offset')||0
        })});
      }
      if(parts[1]==='counts'&&parts.length===2&&method==='POST'){
        requireAccess(member,'inventory.adjust',user);
        return json({count:await service.countStock(tenant,branch,user,body,key)},201);
      }
      if(parts[1]==='adjustments'&&parts.length===2&&method==='POST'){
        requireAccess(member,'inventory.adjust',user);
        return json({movement:await service.adjustStock(tenant,branch,body,key)},201);
      }
      if(parts.length===1&&method==='GET'){
        requireAccess(member,'inventory.view',user);
        return json({stock:await service.stock(tenant,branch)});
      }
      if(parts[1]==='receipts'&&parts.length===2&&method==='POST'){
        requireAccess(member,'inventory.adjust',user);
        return json({movement:await service.receipt(tenant,branch,user,body,key)},201);
      }
    }
    if(feature==='cash'){
      if(parts.length===1&&method==='GET'){
        requireAccess(member,'cash.view',user);
        return json({session:await service.cash(tenant,branch,url.searchParams.get('terminalId')||'DEFAULT')});
      }
      if(parts[1]==='open'&&parts.length===2&&method==='POST'){
        requireAccess(member,'cash.open',user);
        return json({session:await service.openCash(tenant,branch,user,body,key)},201);
      }
    }

    if(feature==='cash'&&parts[1]==='sessions'){
      if(parts.length===3&&parts[2]==='search'&&method==='GET'){
        requireAccess(member,'cash.view',user);
        return json({history:await service.cashSessionsSearch(tenant,branch,{
          operatorId:url.searchParams.get('operatorId')||'',terminalId:url.searchParams.get('terminalId')||'',status:url.searchParams.get('status')||'',
          from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||'',
          limit:url.searchParams.get('limit')||25,offset:url.searchParams.get('offset')||0
        })});
      }
      if(parts.length===2&&method==='GET'){
        requireAccess(member,'cash.view',user);
        return json({sessions:await service.cashSessions(tenant,branch,{terminalId:url.searchParams.get('terminalId')||''})});
      }
      const id=parts[2];
      if(id&&id.length<=128){
        if(parts.length===4&&parts[3]==='movements'&&method==='GET'){
          requireAccess(member,'cash.view',user);
          return json({movements:await service.cashMovements(tenant,branch,id)});
        }
        if(parts.length===4&&method==='POST'&&['supply','withdraw','close'].includes(parts[3])){
          const action=parts[3];
          requireAccess(member,'cash.'+(action==='close'?'close':action),user);
          const result=action==='close'
            ?await service.closeCash(tenant,branch,id,user,body,key)
            :await service.cashAdjust(tenant,branch,id,user,body,key,action==='supply'?'SUPPLY':'WITHDRAWAL');
          return json({result});
        }
      }
    }
    if(feature==='finance'){
      if(parts.length===2&&parts[1]==='summary'&&method==='GET'){
        requireAccess(member,'finance.view',user);
        return json({summary:await service.financeSummary(tenant,branch)});
      }
      if(parts.length===2&&parts[1]==='entries'&&method==='GET'){
        requireAccess(member,'finance.view',user);
        return json({entries:await service.financeEntries(tenant,branch,{
          kind:url.searchParams.get('kind')||'',status:url.searchParams.get('status')||'',
          query:url.searchParams.get('query')||''
        })});
      }
      if(parts.length===2&&parts[1]==='entries'&&method==='POST'){
        requireAccess(member,'finance.manage',user);
        return json({entry:await service.createFinanceEntry(tenant,branch,user,body,key)},201);
      }
      if(parts.length===6&&parts[1]==='entries'&&parts[3]==='settlements'&&parts[5]==='reverse'&&method==='POST'){
        requireAccess(member,'finance.manage',user);
        return json({result:await service.reverseFinanceSettlement(tenant,branch,parts[2],parts[4],user,body,key)});
      }
      if(parts.length===4&&parts[1]==='entries'&&parts[2].length<=128&&method==='POST'){
        requireAccess(member,'finance.manage',user);
        if(parts[3]==='settle')
          return json({settlement:await service.settleFinanceEntry(tenant,branch,parts[2],user,body,key)});
        if(parts[3]==='cancel')
          return json({result:await service.cancelFinanceEntry(tenant,branch,parts[2],user,body,key)});
      }
    }
    if(feature==='reports'){
      if(parts.length===2&&parts[1]==='stock-minimum'&&method==='PUT'){
        requireAccess(member,'inventory.adjust',user);
        return json({minimum:await service.saveInventoryMinimum(tenant,branch,user,body,key)});
      }
      if(parts.length===2&&parts[1]==='commission-targets'&&method==='PUT'){
        requireAccess(member,'sellers.manage',user);
        return json({target:await service.saveSellerSalesTarget(tenant,branch,user,body,key)});
      }
      if(parts.length===2&&parts[1]==='commission-ranking'&&method==='GET'){
        requireAccess(member,'reports.view',user);
        return json({ranking:await service.sellerSalesRanking(tenant,branch,{
          month:url.searchParams.get('month')||undefined
        })});
      }
      if(parts.length===2&&parts[1]==='home'&&method==='GET'){
        requireAccess(member,'reports.view',user);
        return json({home:await service.homeIndicators(tenant,branch,{
          asOf:url.searchParams.get('asOf')||undefined
        })});
      }
      if(parts.length===2&&method==='GET'&&['details','details.csv'].includes(parts[1])){
        requireAccess(member,'reports.view',user);
        const filters={
          from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||'',
          status:url.searchParams.get('status')||'',operatorId:url.searchParams.get('operatorId')||'',
          sellerId:url.searchParams.get('sellerId')||'',customerId:url.searchParams.get('customerId')||'',
          productId:url.searchParams.get('productId')||'',paymentMethod:url.searchParams.get('paymentMethod')||'',
          query:url.searchParams.get('query')||'',
          limit:url.searchParams.get('limit')||25,offset:url.searchParams.get('offset')||0
        };
        return parts[1]==='details'
          ?json({details:await service.reportDetails(tenant,branch,filters)})
          :json({csv:await service.reportDetailsCsv(tenant,branch,filters)});
      }
      if(parts.length===2&&parts[1]==='stock-coverage'&&method==='GET'){
        requireAccess(member,'reports.view',user);
        return json({coverage:await service.reportStockCoverage(tenant,branch,{
          asOf:url.searchParams.get('asOf')||'',
          days:url.searchParams.get('days')||30
        })});
      }
      if(parts.length===2&&parts[1]==='margins'&&method==='GET'){
        requireAccess(member,'reports.view',user);
        return json({margin:await service.marginReport(tenant,branch,{
          from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||'',
          productId:url.searchParams.get('productId')||''
        })});
      }
      if(parts.length===2&&parts[1]==='daily-trend'&&method==='GET'){
        requireAccess(member,'reports.view',user);
        return json({trend:await service.dailySalesTrend(tenant,branch,{
          from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||''
        })});
      }
      if(parts.length===2&&parts[1]==='compare'&&method==='GET'){
        requireAccess(member,'reports.view',user);
        return json({comparison:await service.compareReports(tenant,branch,{
          from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||'',
          compareFrom:url.searchParams.get('compareFrom')||'',compareTo:url.searchParams.get('compareTo')||''
        })});
      }
      if(parts.length===2&&parts[1]==='summary'&&method==='GET'){
        requireAccess(member,'reports.view',user);
        return json({report:await service.reports(tenant,branch,{
          from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||''
        })});
      }
      if(parts.length===2&&parts[1]==='sales.csv'&&method==='GET'){
        requireAccess(member,'reports.view',user);
        return json({csv:await service.salesCsv(tenant,branch,{
          from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||''
        })});
      }
    }
    if(feature==='sales'){
      if(parts.length===2&&parts[1]==='history'&&method==='GET'){
        requireAccess(member,'sales.view',user);
        return json({history:await service.salesHistory(tenant,branch,{
          from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||'',
          status:url.searchParams.get('status')||'',query:url.searchParams.get('query')||'',
          operatorId:url.searchParams.get('operatorId')||'',
          sellerId:url.searchParams.get('sellerId')||'',customerId:url.searchParams.get('customerId')||'',
          productId:url.searchParams.get('productId')||'',paymentMethod:url.searchParams.get('paymentMethod')||'',
          limit:url.searchParams.get('limit')||25,offset:url.searchParams.get('offset')||0
        })});
      }
      if(parts.length===1&&method==='GET'){
        requireAccess(member,'sales.view',user);
        return json({sales:await service.listSales(tenant,branch,Number(url.searchParams.get('limit')||25),url.searchParams.get('status')||null)});
      }
      if(parts.length===1&&method==='POST'){
        requireAccess(member,'sales.create',user);
        return json({sale:await service.openSale(tenant,branch,user,body,key)},201);
      }
      const id=parts[1];
      if(!id||id.length>128)return null;
      if(parts.length===2&&method==='GET'){
        requireAccess(member,'sales.view',user);
        return json({sale:await service.sale(tenant,branch,id)});
      }
      if(parts.length===4&&parts[2]==='returns'&&parts[3]==='quote'&&method==='POST'){
        requireAccess(member,'sales.view',user);
        return json({quote:await service.quoteSaleReturn(tenant,branch,id,body)});
      }
      if(parts.length===3&&parts[2]==='returns'&&method==='GET'){
        requireAccess(member,'sales.view',user);
        return json({returns:await service.saleReturns(tenant,branch,id)});
      }
      if(parts.length===3&&parts[2]==='returns'&&method==='POST'){
        requireAccess(member,'sales.cancel',user);
        return json({result:await service.returnSale(tenant,branch,id,user,body,key)},201);
      }
      requireAccess(member,'sales.create',user);
      if(parts.length===3&&parts[2]==='customer'&&method==='POST')
        return json({sale:await service.assignSaleCustomer(tenant,branch,id,body.customerId)});
      if(parts.length===3&&parts[2]==='seller'&&method==='POST')
        return json({sale:await service.assignSaleSeller(tenant,branch,id,body.sellerId)});
      if(parts[2]==='items'&&parts[3]==='configured'&&parts.length===4&&method==='POST')
        return json({sale:await service.addConfiguredItem(tenant,branch,id,body,key)});
      if(parts[2]==='items'&&parts[3]==='weighted'&&parts.length===4&&method==='POST')
        return json({sale:await service.addWeightedItem(tenant,branch,id,body,key)});
      if(parts[2]==='weight-items'&&parts.length===4&&method==='DELETE')
        return json({sale:await service.removeWeightedItem(tenant,branch,id,parts[3])});
      if(parts[2]==='items'){
        if(parts.length===5&&parts[4]==='configured'){
          if(method==='PUT')return json({sale:await service.changeConfiguredItemQuantity(tenant,branch,id,parts[3],body.quantity)});
          if(method==='DELETE')return json({sale:await service.removeConfiguredItem(tenant,branch,id,parts[3])});
        }
        if(parts.length===5&&parts[4]==='note'&&method==='PUT'){
          return json({sale:await service.changeItemNote(tenant,branch,id,decodeURIComponent(parts[3]),user,body,key)});
        }
        if(parts.length===5&&parts[4]==='price'&&method==='PUT'){
          requireAccess(member,'sales.discount',user);
          return json({sale:await service.overrideItemPrice(tenant,branch,id,decodeURIComponent(parts[3]),user,body,key)});
        }
        if(parts.length===3&&method==='POST')
          return json({sale:await service.addItem(tenant,branch,id,body,key)});
        if(parts.length===4&&method==='PUT')
          return json({sale:await service.changeItem(tenant,branch,id,decodeURIComponent(parts[3]),body.quantity,key)});
        if(parts.length===4&&method==='DELETE')
          return json({sale:await service.removeItem(tenant,branch,id,decodeURIComponent(parts[3]),key)});
      }
      if(parts.length===3&&parts[2]==='discount'&&method==='POST'){
        requireAccess(member,'sales.discount',user);
        return json({sale:await service.discount(tenant,branch,id,body.discountCents,key)});
      }
      if(parts.length===3&&parts[2]==='suspend'&&method==='POST')
        return json({sale:await service.transition(tenant,branch,id,'SUSPENDED',key)});
      if(parts.length===3&&parts[2]==='resume'&&method==='POST')
        return json({sale:await service.transition(tenant,branch,id,'OPEN',key)});
      if(parts.length===3&&parts[2]==='cancel'&&method==='POST'){
        requireAccess(member,'sales.cancel',user);
        const sale=await service.sale(tenant,branch,id);
        // A cancelled OPEN sale has no completed_at, so its replay belongs to the
        // keyed status-transition ledger, not to refunds for completed sales.
        if(sale.status==='COMPLETED'||(sale.status==='CANCELLED'&&sale.completedAt)){
          const result=await service.cancelCompletedSale(tenant,branch,id,user,body,key);
          return json({sale:{...sale,status:'CANCELLED'},result});
        }
        return json({sale:await service.transition(tenant,branch,id,'CANCELLED',key)});
      }
      if(parts.length===3&&parts[2]==='complete'&&method==='POST')
        return json({sale:await service.complete(tenant,branch,id,user,body,key)});
    }
    return null;
  }catch(e){
    const parsed=commerceError(e);
    return fail(parsed.status,parsed.message);
  }
}
