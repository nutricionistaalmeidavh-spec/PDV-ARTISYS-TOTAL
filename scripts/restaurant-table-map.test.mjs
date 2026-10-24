import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../apps/web/restaurant-web-ui.js',import.meta.url),'utf8');

async function renderTables({paginated=false}={}){
  let html='';
  const host={
    get innerHTML(){return html;},set innerHTML(value){html=value;},
    querySelectorAll(){return [];},querySelector(){return null;}
  };
  const tables=[
    {id:'free',label:'Mesa <01>',seats:4,active:1,sessionId:null},
    {id:'occupied',label:'02',seats:4,active:1,sessionId:'session-2',sessionStatus:'OPEN',partySize:2},
    {id:'checkout',label:'03',seats:4,active:1,sessionId:'session-3',sessionStatus:'CHECKOUT',partySize:1},
    {id:'inactive',label:'Desativada',seats:4,active:0,sessionId:null}
  ];
  const orders=[
    {id:'order-2',table_session_id:'session-2',status:'OPEN',total_cents:3880,items:[{quantity:2}]},
    {id:'order-3',table_session_id:'session-3',status:'OPEN',total_cents:4700,items:[{quantity:1}]}
  ];
  class ApiClient {
    webMode=true;
    async request(endpoint){
      if(endpoint.endsWith('/tables'))return {tables};
      if(endpoint.includes('/orders?limit=40'))return {orders,nextCursor:paginated?'cursor-40':null};
      if(endpoint.includes('/reports/orders?'))return {orders:[],nextCursor:null};
      if(endpoint.endsWith('/kitchen'))return {tickets:[]};
      if(endpoint.endsWith('/kitchen/station-tickets'))return {tickets:[]};
      if(endpoint.endsWith('/kitchen/print-jobs'))return {jobs:[]};
      if(endpoint.endsWith('/requests'))return {requests:[]};
      return {report:{}};
    }
    async products(){return [];}
  }
  const window={PdvApiClient:{ApiClient},PdvAccessPolicy:{hasCapability:()=>true},PdvCurrentAccess:{}};
  runInNewContext(source,{window,document:{getElementById:()=>host},Date});
  await window.PdvRestaurantWebUi.show();
  return html;
}

test('mapa visual mantém cadeiras, cores semânticas e ações canônicas de mesa',async()=>{
  const html=await renderTables();
  assert.match(html,/restaurant-floor-map/);
  assert.match(html,/restaurant-table-seat--top/);
  assert.match(html,/restaurant-table-seat--left/);
  assert.match(html,/restaurant-floor-table is-free/);
  assert.match(html,/restaurant-floor-table is-occupied/);
  assert.match(html,/restaurant-floor-table is-checkout/);
  assert.match(html,/data-r4-action="open" data-id="free"/);
  assert.match(html,/data-r4-action="select" data-id="session-2"/);
  assert.match(html,/data-r4-action="select" data-id="session-3"/);
  assert.match(html,/Mesa &lt;01&gt;/);
  assert.doesNotMatch(html,/Desativada/);
  assert.match(html,/R\$[\s\u00a0]*38,80/);
  assert.match(html,/2 itens/);
  assert.match(html,/Pré-conta/);
});

test('paginação de pedidos não apresenta subtotal incompleto como valor total da mesa',async()=>{
  const html=await renderTables({paginated:true});
  assert.doesNotMatch(html,/R\$[\s\u00a0]*38,80/);
  assert.match(html,/Ver comanda/);
});
