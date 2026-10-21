import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=name=>readFileSync(new URL('../apps/web/'+name,import.meta.url),'utf8');
function browser({desktop=false,permissions=['inventory.adjust','wholesale.access']}={}){
  const calls=[],navigation=[],events=new Map(),updated=[],elements=new Map();
  function element(selector){
    if(!elements.has(selector))elements.set(selector,{dataset:{},values:new Map(),disabled:false,
      addEventListener:(type,fn)=>events.set(selector+':'+type,fn),querySelector:child=>element(selector+' '+child)});
    return elements.get(selector);
  }
  const node={innerHTML:'',querySelector:element,querySelectorAll:()=>[]};
  const responses={
    'purchasing/orders':{orders:[{id:'po1',supplierId:'supplier1',status:'PARTIAL',items:[{id:'line1',productId:'product1',remainingQuantity:2}],totalOrderedCents:300,totalReceivedCents:100}]},
    suppliers:{suppliers:[{id:'supplier1',name:'Fornecedor Um'}]},
    products:{products:[{id:'product1',name:'Farinha',trackStock:true,active:true}]},
    'inventory/locations':{locations:[{id:'loc1',code:'A1',name:'Prateleira',assignedProducts:1}]},
    'inventory/transfers':{transfers:[{id:'transfer1',fromBranchId:'branch-main',toBranchId:'branch-other',productId:'product1',quantity:2,reason:'Reposição'}]},
    'inventory/reservations':{reservations:[{id:'reserve1',productId:'product1',quantity:1,status:'ACTIVE',reason:'Separado'}]},
    branches:{branches:[{id:'branch-main',name:'Matriz'},{id:'branch-other',name:'Outra loja'}]}
  };
  const window={
    location:{origin:'https://pdv.example.test'},crypto:{randomUUID:()=> 'operation-qa'},
    PdvCurrentAccess:{permissions},
    PdvAccessPolicy:{hasCapability:(user,cap)=>user.permissions.includes(cap),canAccessRoute:(user,route)=>route==='WHOLESALE'&&user.permissions.includes('wholesale.access')},
    PdvRouteRegistry:{updated:(route,data)=>updated.push({route,data})},
    PdvAppNavigation:{navigate:async route=>navigation.push(route)},
    PdvCatalogAdmin:{openPurchaseOrders:()=>navigation.push('purchase-modal')},
    fetch:async(url,options)=>{
      const parsed=new URL(url),prefix='/api/v1/tenants/tenant-qa/';
      assert.ok(parsed.pathname.startsWith(prefix),'all requests are tenant scoped');
      const route=parsed.pathname.slice(prefix.length),body=options.body&&JSON.parse(options.body);
      calls.push({route,method:options.method,branchId:parsed.searchParams.get('branchId'),body,headers:options.headers});
      let value=responses[route];
      if(options.method==='POST'&&route==='purchasing/orders/po1/receive')value={receipt:{receiptId:'receipt1',items:body.items}};
      if(options.method==='POST'&&route==='inventory/transfers')value={transfer:{id:'new-transfer',...body}};
      assert.ok(value,'supported hosted endpoint '+route);
      return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>value};
    }
  };
  if(desktop)window.artisysDesktop={apiRequest:async()=>({ok:true,payload:[]})};
  const context={window,document:{getElementById:()=>node},URL,URLSearchParams,FormData:class{
    constructor(form){this.values=form.values;}get(key){return this.values.get(key);}
  }};
  runInNewContext(read('api-client.js'),context);
  const client=new window.PdvApiClient.ApiClient();client.tenantId='tenant-qa';client.branchId='branch-main';
  runInNewContext(read('enterprise-depth-api-client.js'),context);
  runInNewContext(read('enterprise-depth-ui.js'),context);
  return {window,client,calls,navigation,node,events,updated,element};
}

test('loading desktop enterprise extensions preserves hosted purchasing and receipt line contracts',async()=>{
  const x=browser();
  const orders=await x.client.purchaseOrders();
  assert.equal(orders[0].status,'PARTIAL');
  const receipt=await x.client.receivePurchaseOrder('po1',[{lineId:'line1',quantity:2}],'receipt-retry-key');
  assert.equal(receipt.receiptId,'receipt1');
  assert.equal(x.calls[0].route,'purchasing/orders');
  assert.equal(x.calls[0].branchId,'branch-main');
  assert.equal(x.calls[1].body.items[0].lineId,'line1');
  assert.equal(x.calls[1].headers['x-mutation-id'],'receipt-retry-key');
});

test('hosted transfers keep branch-based atomic contract after enterprise script loads',async()=>{
  const x=browser();
  await x.client.stockTransfers();
  await x.client.transferStock({toBranchId:'branch-other',productId:'product1',quantity:2,reason:'Reposição'},'transfer-retry-key');
  assert.equal(x.calls[0].route,'inventory/transfers');
  assert.equal(x.calls[1].body.branchId,'branch-main');
  assert.equal(x.calls[1].body.toBranchId,'branch-other');
  assert.equal(x.calls[1].headers['x-mutation-id'],'transfer-retry-key');
  assert.equal(x.calls.some(call=>call.route.includes('stock-transfers')),false);
});

test('Compras renders hosted orders and opens the existing multi-item receiving editor',async()=>{
  const x=browser();await x.window.PdvEnterpriseDepthUi.renderPurchases();
  assert.match(x.node.innerHTML,/Fornecedor Um/);
  assert.match(x.node.innerHTML,/R\$ 1,00 recebidos/);
  assert.doesNotMatch(x.node.innerHTML,/Não foi possível/);
  x.events.get('[data-purchase-manage]:click')();
  assert.deepEqual(x.navigation,['purchase-modal']);
});

test('Logística renders real storage addresses, branch transfers and reservation quantities',async()=>{
  const x=browser();await x.window.PdvEnterpriseDepthUi.renderLogistics();
  assert.match(x.node.innerHTML,/A1 · Prateleira/);
  assert.match(x.node.innerHTML,/Matriz → Outra loja/);
  assert.match(x.node.innerHTML,/Farinha · 1/);
  assert.match(x.node.innerHTML,/O saldo pertence à filial/);
  assert.doesNotMatch(x.node.innerHTML,/Não foi possível|undefined|Despachar|Receber transferência/);
  assert.equal(x.calls.some(call=>/stock-locations|stock-transfers|stock-reservations/.test(call.route)),false);
});

test('inventory read-only profile sees logistics without stock mutation forms',async()=>{
  const x=browser({permissions:['inventory.view']});
  await x.window.PdvEnterpriseDepthUi.renderLogistics();
  assert.match(x.node.innerHTML,/Transferências registradas/);
  assert.doesNotMatch(x.node.innerHTML,/<form|Liberar reserva/);
  await x.window.PdvEnterpriseDepthUi.renderPurchases();
  assert.doesNotMatch(x.node.innerHTML,/data-purchase-manage/);
});

test('logistics submission sends one branch transfer with the selected quantity and reason',async()=>{
  const x=browser();await x.window.PdvEnterpriseDepthUi.renderLogistics();
  x.element('#web-logistics-transfer').values=new Map([
    ['toBranchId','branch-other'],['productId','product1'],['quantity','2.5'],['reason','Reposição de balcão']
  ]);
  await x.events.get('#web-logistics-transfer:submit')({preventDefault(){}});
  const writes=x.calls.filter(call=>call.method==='POST');assert.equal(writes.length,1);
  assert.equal(writes[0].route,'inventory/transfers');assert.equal(writes[0].body.quantity,2.5);
  assert.equal(writes[0].body.branchId,'branch-main');assert.equal(writes[0].body.toBranchId,'branch-other');
  assert.equal(writes[0].body.reason,'Reposição de balcão');
});

test('Pedidos reuses the authorized wholesale navigation instead of legacy sales-orders API',async()=>{
  const x=browser();await x.window.PdvEnterpriseDepthUi.renderOrders();
  assert.deepEqual(x.navigation,['WHOLESALE']);assert.equal(x.calls.length,0);
});

test('desktop preserves the existing stock locations and purchase IPC routes',async()=>{
  const x=browser({desktop:true}),paths=[];
  x.client.request=async path=>{paths.push(path);return[];};
  await x.client.stockLocations();await x.client.purchaseOrders();
  assert.deepEqual(paths,['/api/v1/stock-locations','/api/v1/purchase-orders']);
});
