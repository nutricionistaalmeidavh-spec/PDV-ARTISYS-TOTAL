import {createVerticalService} from './vertical-service.mjs';
import {createR4ExtendedService} from './r4-extended-service.mjs';
import canonicalAuthorization from '../../../packages/core/js/core/auth/authorization-service.js';
import canonicalProfiles from '../../../packages/core/js/core/auth/default-profiles.js';

const {createAuthorizationService}=canonicalAuthorization;
const {DEFAULT_PROFILE_PERMISSIONS}=canonicalProfiles;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(status,message)=>json({error:message},status);
function permission(member,userId,capability){
 const profile=member.profileKey==='OWNER'?'ADMINISTRATOR':member.profileKey;
 const authz=createAuthorizationService({resolvePermissions:()=>DEFAULT_PROFILE_PERMISSIONS[profile]||[]});
 if(!authz.can({principal:{kind:'human',id:userId},capability}))
   throw Object.assign(new Error('Permissão insuficiente.'),{status:403});
}
async function readBody(request){
 if(Number(request.headers.get('content-length')||0)>16384)throw Object.assign(new Error('Requisição muito grande.'),{status:413});
 if(!request.headers.get('content-type')?.includes('application/json'))throw Object.assign(new Error('Formato JSON obrigatório.'),{status:415});
 const raw=await request.text();
 if(raw.length>16384)throw Object.assign(new Error('Requisição muito grande.'),{status:413});
 let body;try{body=JSON.parse(raw);}catch{}
 if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(new Error('Dados inválidos.'),{status:400});
 return body;
}
export async function verticalRoute(request,db,session,member,tenantId,path){
 const url=new URL(request.url),method=request.method,parts=path.split('/').filter(Boolean);
 const feature=parts[0];
 if(!['customers','suppliers','sellers','restaurant','recipes','onboarding','wholesale','commissions','credit'].includes(feature))return null;
 const svc=createVerticalService(db),ext=createR4ExtendedService(db),user=session.userId;
 try{
   const write=['POST','PATCH','PUT','DELETE'].includes(method),body=write?await readBody(request):{};
   const branch=body.branchId||url.searchParams.get('branchId');
   if(!branch)throw Object.assign(new Error('Selecione a filial.'),{status:400});
   const key=request.headers.get('x-mutation-id');
   if(['customers','suppliers'].includes(feature)&&parts.length===1){
     const singular=feature==='customers'?'customer':'supplier';
     if(method==='GET'){permission(member,user,singular+'s.view');return json({[feature]:await svc.contacts(tenantId,branch,feature)});}
     if(method==='POST'){permission(member,user,singular+'s.manage');return json({[singular]:await svc.upsertContact(tenantId,branch,feature,body,key)},201);}
   }
   if(feature==='sellers'&&parts.length===1&&method==='GET'){
     permission(member,user,'sellers.view');return json({sellers:await svc.sellers(tenantId,branch)});
   }
   if(feature==='onboarding'){
     if(parts[1]==='segments'&&parts.length===2&&method==='GET'){
       permission(member,user,'settings.view');
       return json(await ext.segments(tenantId,branch));
     }
     if(parts[1]==='segments'&&parts.length===2&&method==='PUT'){
       permission(member,user,'settings.manage');
       return json({choice:await ext.selectSegment(tenantId,branch,body,key)});
     }
   }
   if(feature==='recipes'&&parts[1]){
     if(parts.length===2&&method==='GET'){
       permission(member,user,'products.view');
       return json({recipe:await ext.recipe(tenantId,branch,parts[1])});
     }
     if(parts.length===2&&method==='PUT'){
       permission(member,user,'products.manage');
       return json({recipe:await ext.saveRecipe(tenantId,branch,parts[1],body,key)});
     }
   }
   if(feature==='restaurant'){
     permission(member,user,'restaurant.access');
     if(parts[1]==='segments'&&parts.length===2&&method==='GET'){
       permission(member,user,'restaurant.orders.view');return json(await ext.segments(tenantId,branch));
     }
     if(parts[1]==='weight'&&parts[2]==='quote'&&parts.length===3&&method==='POST'){
       permission(member,user,'products.view');return json({quote:await ext.quoteWeight(tenantId,branch,body)});
     }
     if(parts[1]==='pizzeria'){
       if(parts.length===3&&parts[2]==='profiles'){
         if(method==='GET'){permission(member,user,'products.view');return json({profiles:await ext.pizzaProfiles(tenantId,branch)});}
         if(method==='POST'){permission(member,user,'products.manage');return json({profile:await ext.savePizzaProfile(tenantId,branch,body,key)},201);}
       }
       if(parts.length===4&&parts[2]==='products'&&method==='GET'){
         permission(member,user,'products.view');return json({profile:await ext.pizzaProfile(tenantId,branch,parts[3])});
       }
       if(parts.length===3&&parts[2]==='quote'&&method==='POST'){
         permission(member,user,'products.view');return json({quote:await ext.quotePizza(tenantId,branch,body)});
       }
     }
     if(parts[1]==='kitchen'&&parts[2]==='stations'){
       if(parts.length===3&&method==='GET'){
         permission(member,user,'kitchen.view');return json({stations:await ext.stations(tenantId,branch)});
       }
       if(parts.length===3&&method==='POST'){
         permission(member,user,'settings.manage');return json({station:await ext.saveStation(tenantId,branch,body,key)},201);
       }
     }
     if(parts[1]==='kitchen'&&parts[2]==='routes'){
       if(parts.length===3&&method==='GET'){
         permission(member,user,'kitchen.view');return json({routes:await ext.routes(tenantId,branch)});
       }
       if(parts.length===3&&method==='POST'){
         permission(member,user,'products.manage');return json({route:await ext.setRoute(tenantId,branch,body,key)},201);
       }
     }
     if(parts[1]==='kitchen'&&parts[2]==='station-tickets'){
       if(parts.length===3&&method==='GET'){
         permission(member,user,'kitchen.view');return json({tickets:await ext.tickets(tenantId,branch)});
       }
       if(parts.length===4&&method==='PATCH'){
         permission(member,user,'kitchen.update_status');
         return json({ticket:await ext.updateTicket(tenantId,branch,parts[3],body.status,key)});
       }
     }
     if(parts[1]==='tables'){
       if(parts.length===2&&method==='GET'){permission(member,user,'restaurant.orders.view');return json({tables:await svc.tables(tenantId,branch)});}
       if(parts.length===2&&method==='POST'){permission(member,user,'restaurant.tables.manage');return json({table:await svc.saveTable(tenantId,branch,body,key)},201);}
       if(parts.length===4&&parts[3]==='open'&&method==='POST'){permission(member,user,'restaurant.tables.manage');return json({session:await svc.openTable(tenantId,branch,user,parts[2],body,key)},201);}
     }
     if(parts[1]==='sessions'&&parts[2]){
       if(parts.length===3&&method==='GET'){permission(member,user,'restaurant.orders.view');return json({session:await svc.tableSession(tenantId,branch,parts[2])});}
       if(parts.length===4&&parts[3]==='close'&&method==='POST'){permission(member,user,'restaurant.tables.manage');return json({session:await svc.closeTable(tenantId,branch,parts[2],key)});}
       if(parts.length===4&&parts[3]==='checkout'&&method==='GET'){
         permission(member,user,'restaurant.orders.view');
         return json({checkout:await svc.linkedCheckout(tenantId,branch,{tableSessionId:parts[2]})});
       }
       if(parts.length===4&&parts[3]==='transfer'&&method==='POST'){
         permission(member,user,'restaurant.orders.transfer');
         return json({session:await svc.transferTable(tenantId,branch,parts[2],body.targetTableId,key)});
       }
       if(parts.length===4&&parts[3]==='requests'&&method==='POST'){
         permission(member,user,'restaurant.service.manage');
         return json({request:await svc.createServiceRequest(tenantId,branch,user,parts[2],body,key)},201);
       }
     }
     if(parts[1]==='requests'){
       permission(member,user,'restaurant.service.manage');
       if(parts.length===2&&method==='GET')return json({requests:await svc.serviceRequests(tenantId,branch)});
       if(parts.length===3&&method==='PATCH')
         return json({request:await svc.updateServiceRequest(tenantId,branch,user,parts[2],body,key)});
     }
     if(parts[1]==='reports'&&parts.length===3&&method==='GET'){
       permission(member,user,'reports.view');
       const from=url.searchParams.get('from'),to=url.searchParams.get('to');
       if(parts[2]==='summary')return json({report:await svc.restaurantReport(tenantId,branch,from,to)});
       if(parts[2]==='csv')return new Response(await svc.restaurantReport(tenantId,branch,from,to,{csv:true}),{
         status:200,headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="restaurant-operations.csv"','cache-control':'no-store','x-content-type-options':'nosniff'}
       });
     }
     if(parts[1]==='orders'&&parts.length===2){
       if(method==='GET'){permission(member,user,'restaurant.orders.view');return json({orders:await svc.foodOrders(tenantId,branch,url.searchParams.get('fulfillment')||'')});}
       if(method==='POST'){permission(member,user,'restaurant.orders.create');return json({order:await svc.createFoodOrder(tenantId,branch,user,body,key)},201);}
     }
     if(parts[1]==='orders'&&parts.length===4&&parts[3]==='checkout'&&method==='GET'){
       permission(member,user,'restaurant.orders.view');
       return json({checkout:await svc.linkedCheckout(tenantId,branch,{orderId:parts[2]})});
     }
     if(parts[1]==='orders'&&parts.length===4&&parts[3]==='cancel'&&method==='POST'){
       permission(member,user,'restaurant.orders.transfer');
       return json({order:await svc.cancelFoodOrder(tenantId,branch,parts[2],key)});
     }
     if(parts[1]==='orders'&&parts.length===4&&parts[3]==='deliver'&&method==='POST'){
       permission(member,user,'restaurant.orders.transfer');
       return json({order:await svc.deliverFoodOrder(tenantId,branch,parts[2],key)});
     }
     if(parts[1]==='kitchen'){
       if(parts.length===2&&method==='GET'){permission(member,user,'kitchen.view');return json({tickets:await svc.kitchen(tenantId,branch)});}
       if(parts.length===3&&method==='PATCH'){permission(member,user,'kitchen.update_status');return json({ticket:await svc.updateKitchen(tenantId,branch,parts[2],body,key)});}
     }
   }
   if(feature==='wholesale'){
     permission(member,user,'wholesale.access');
     if(parts[1]==='tiers'&&parts.length===2){
       if(method==='GET')return json({tiers:await svc.wholesaleTiers(tenantId,branch)});
       if(method==='POST'){permission(member,user,'wholesale.orders.manage');return json({tier:await svc.saveWholesaleTier(tenantId,branch,body,key)},201);}
     }
     if(parts[1]==='price'&&parts.length===2&&method==='GET')
       return json({price:await svc.wholesalePrice(tenantId,branch,url.searchParams.get('productId'),Number(url.searchParams.get('quantity')))});
     if(parts[1]==='orders'){
       if(parts.length===2&&method==='GET')return json({orders:await svc.wholesaleOrders(tenantId,branch)});
       if(parts.length===2&&method==='POST'){permission(member,user,'wholesale.orders.manage');return json({order:await svc.wholesaleQuote(tenantId,branch,user,body,key)},201);}
       if(parts.length===3&&method==='GET')return json({order:await svc.wholesaleOrder(tenantId,branch,parts[2])});
       if(parts.length===4&&method==='POST'&&['confirm','cancel'].includes(parts[3])){
         permission(member,user,'wholesale.orders.manage');return json({order:await svc.wholesaleTransition(tenantId,branch,parts[2],parts[3]==='confirm'?'CONFIRMED':'CANCELLED',key)});
       }
     }
   }
   if(feature==='commissions'){
     if(parts[1]==='rules'&&parts.length===2){
       if(method==='GET'){permission(member,user,'sellers.view');return json({rules:await svc.commissionRules(tenantId,branch)});}
       if(method==='POST'){permission(member,user,'sellers.manage');return json({rule:await svc.saveCommissionRule(tenantId,branch,body,key)},201);}
     }
     if(parts.length===1&&method==='GET'){permission(member,user,'finance.view');return json({balances:await svc.commissions(tenantId,branch)});}
   }
   if(feature==='credit'&&parts[1]&&parts.length===3&&parts[2]==='payments'&&method==='POST'){
     permission(member,user,'finance.manage');
     return json({receipt:await svc.payCredit(tenantId,branch,user,parts[1],body,key)},201);
   }
   if(feature==='credit'&&parts[1]&&parts.length===2&&method==='GET'){
     permission(member,user,'customers.view');
     return json({credit:await svc.credit(tenantId,branch,parts[1])});
   }
   return null;
 }catch(e){
   if(e.status)return fail(e.status,e.message);
   return fail(500,'Erro interno. Operação não confirmada.');
 }
}
