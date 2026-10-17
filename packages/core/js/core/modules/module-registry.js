'use strict';

const AREAS=Object.freeze({
  FOOD:Object.freeze({id:'FOOD',label:'Alimentação',description:'Pedidos, produção/KDS e canais de atendimento',icon:'store',routeId:'FOOD',navigation:'module'}),
  WHOLESALE:Object.freeze({id:'WHOLESALE',label:'Atacado',description:'Pedidos com preço automático por faixa de quantidade',icon:'document',routeId:'WHOLESALE',navigation:'module'})
});

const MODULES=Object.freeze([
  {id:'FOOD',name:'Alimentação',description:'Pedidos e produção/KDS com canais de mesa, balcão, retirada e entrega',defaultEnabled:true,dependsOn:[],area:AREAS.FOOD,routeId:'FOOD',icon:'store',accessCapability:'restaurant.access',manageCapability:'modules.manage'},
  {id:'WHOLESALE',name:'Atacado',description:'Pedidos com cliente obrigatório e preço por quantidade, reutilizando estoque, caixa e financeiro',defaultEnabled:false,dependsOn:[],area:AREAS.WHOLESALE,routeId:'WHOLESALE',icon:'document',accessCapability:'wholesale.access',manageCapability:'modules.manage'}
].map(module=>Object.freeze({...module,dependsOn:Object.freeze([...module.dependsOn])})));

const BY_ID=new Map(MODULES.map(item=>[item.id,item]));
function getModuleDefinition(id){return BY_ID.get(String(id||'').trim().toUpperCase())||null;}
function getAreaDefinition(id){return Object.values(AREAS).find(area=>area.id===String(id||'').trim().toUpperCase())||null;}

module.exports={AREAS,MODULES,getAreaDefinition,getModuleDefinition};
