'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const model=require('../desktop/renderer/access-center-model');

const groups={
  sales:{id:'sales',label:'Vendas e pós-venda'},
  cash:{id:'cash',label:'Caixa'},
  access:{id:'access',label:'Acessos e equipe'}
};

const permissions=[
  {id:'sales.view',group:'sales',label:'Consultar vendas',description:'Acessar vendas.'},
  {id:'sales.create',group:'sales',label:'Realizar vendas',description:'Criar vendas.'},
  {id:'cash.view',group:'cash',label:'Consultar caixa',description:'Consultar caixa.'},
  {id:'profiles.assign',group:'access',label:'Atribuir perfis',description:'Atribuir perfis.'}
];

test('Access Center UX groups permissions by business label and supports search',()=>{
  const grouped=model.permissionGroups({permissions,groups,selectedIds:['sales.view','cash.view'],query:''});
  assert.deepEqual(grouped.map(group=>({id:group.id,label:group.label,selected:group.selected,total:group.total})),[
    {id:'sales',label:'Vendas e pós-venda',selected:1,total:2},
    {id:'cash',label:'Caixa',selected:1,total:1},
    {id:'access',label:'Acessos e equipe',selected:0,total:1}
  ]);
  const filtered=model.permissionGroups({permissions,groups,selectedIds:['sales.view'],query:'caixa'});
  assert.deepEqual(filtered.map(group=>group.id),['cash']);
  assert.deepEqual(filtered[0].permissions.map(permission=>permission.id),['cash.view']);

  const searched=model.permissionGroups({permissions,groups,selectedIds:['sales.view'],query:'realizar'});
  assert.deepEqual(searched.map(group=>({id:group.id,selected:group.selected,total:group.total,visible:group.permissions.map(permission=>permission.id)})),[
    {id:'sales',selected:1,total:2,visible:['sales.create']}
  ]);
});

test('Access Center UX summarizes profile usage and deletion safety',()=>{
  const users=[
    {id:'u1',profileId:'p1',active:true},
    {id:'u2',profileId:'p1',active:false},
    {id:'u3',profileId:'p2',active:true}
  ];
  assert.equal(model.profileUsageCount(users,'p1'),2);
  assert.deepEqual(model.profileDeleteState({id:'p1',protected:false},users),{
    protected:false,
    usageCount:2,
    blocked:true,
    reason:'in-use'
  });
  assert.deepEqual(model.profileDeleteState({id:'p2',protected:true},users),{
    protected:true,
    usageCount:1,
    blocked:true,
    reason:'protected'
  });
  assert.deepEqual(model.profileDeleteState({id:'p3',protected:false},users),{
    protected:false,
    usageCount:0,
    blocked:false,
    reason:null
  });
});

test('Access Center UX filters profiles by name and usage context',()=>{
  const profiles=[
    {id:'profile-administrator',name:'Administrador',protected:true,active:true},
    {id:'p-stock',name:'Estoque',protected:false,active:true},
    {id:'p-old',name:'Operação antiga',protected:false,active:false}
  ];
  const users=[{id:'u1',profileId:'p-stock',active:true}];
  assert.deepEqual(model.filterProfiles(profiles,{query:'esto',users}).map(item=>item.id),['p-stock']);
  const all=model.filterProfiles(profiles,{query:'',users});
  assert.equal(all.find(item=>item.id==='p-stock').usageCount,1);
  assert.equal(all.find(item=>item.id==='profile-administrator').systemProfile,true);
});


test('Access Center UX disables hidden bulk permission actions while searching',()=>{
  assert.equal(model.permissionGroupBulkAction({selected:1,total:4,query:'relatórios'}),null);
  assert.deepEqual(model.permissionGroupBulkAction({selected:1,total:4,query:''}),{action:'select',label:'Selecionar grupo'});
  assert.deepEqual(model.permissionGroupBulkAction({selected:4,total:4,query:''}),{action:'clear',label:'Limpar grupo'});
});
