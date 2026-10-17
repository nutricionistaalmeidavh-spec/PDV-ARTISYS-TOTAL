'use strict';

const {PERMISSIONS}=require('./permission-registry');

const idsByPrefix=(...prefixes)=>PERMISSIONS
  .map(permission=>permission.id)
  .filter(id=>prefixes.some(prefix=>id===prefix||id.startsWith(prefix+'.')));

const unique=(...values)=>[...new Set(values.flat())].sort();

const STAFF_PERMISSION_IDS=Object.freeze(
  PERMISSIONS.map(permission=>permission.id).filter(id=>!id.startsWith('public.'))
);

const DEFAULT_PROFILE_IDS=Object.freeze({
  ADMINISTRATOR:'profile-administrator',
  MANAGER:'profile-manager',
  SUPERVISOR:'profile-supervisor',
  CASHIER:'profile-cashier',
  OPERATOR:'profile-operator',
  WAITER:'profile-waiter',
  KITCHEN:'profile-kitchen',
  STOCKKEEPER:'profile-stockkeeper',
  PURCHASING:'profile-purchasing',
  FINANCE:'profile-finance',
  DELIVERY:'profile-delivery',
  READ_ONLY:'profile-read-only'
});

const DEFAULT_PROFILE_PERMISSIONS=Object.freeze({
  ADMINISTRATOR:Object.freeze([...STAFF_PERMISSION_IDS]),
  MANAGER:Object.freeze(unique(
    idsByPrefix('sales','returns','cash','customers','products','suppliers','sellers','inventory','restaurant','wholesale','finance','reports','management'),
    [
      'users.view','users.create','users.edit','users.reset_password',
      'profiles.assign','devices.view',
      'modules.view','settings.view'
    ]
  )),
  SUPERVISOR:Object.freeze(unique(
    idsByPrefix('sales','returns','cash','customers','restaurant','wholesale'),
    [
      'products.view','suppliers.view','sellers.view',
      'inventory.view','inventory.adjust',
      'reports.view','management.view','users.view'
    ]
  )),
  CASHIER:Object.freeze(unique([
    'sales.view','sales.create',
    'returns.view','returns.manage',
    'cash.view','cash.open','cash.close','cash.supply','cash.withdraw',
    'customers.view','customers.manage','products.view'
  ])),
  OPERATOR:Object.freeze(unique([
    'sales.view','sales.create','returns.view',
    'customers.view','customers.manage','products.view'
  ])),
  WAITER:Object.freeze(unique([
    'restaurant.access','restaurant.orders.view','restaurant.orders.create',
    'restaurant.orders.transfer','restaurant.tables.manage','restaurant.service.manage',
    'customers.view','products.view'
  ])),
  KITCHEN:Object.freeze(unique([
    'restaurant.access','kitchen.view','kitchen.update_status'
  ])),
  STOCKKEEPER:Object.freeze(unique([
    'products.view','suppliers.view',
    'inventory.view','inventory.adjust','inventory.procurement'
  ])),
  PURCHASING:Object.freeze(unique([
    'products.view','suppliers.view','suppliers.manage',
    'inventory.view','inventory.procurement','finance.view'
  ])),
  FINANCE:Object.freeze(unique([
    'finance.view','finance.manage','reports.view','management.view',
    'cash.view','sales.view'
  ])),
  DELIVERY:Object.freeze(unique([
    'restaurant.access','restaurant.orders.view','restaurant.orders.create',
    'kitchen.view','kitchen.update_status',
    'customers.view','products.view','sales.view'
  ])),
  READ_ONLY:Object.freeze(unique([
    'sales.view','returns.view','cash.view',
    'customers.view','products.view','suppliers.view','sellers.view',
    'inventory.view','restaurant.access','restaurant.orders.view','kitchen.view',
    'wholesale.access','finance.view','reports.view','management.view',
    'users.view','modules.view','settings.view'
  ]))
});

const definitions=[
  ['ADMINISTRATOR','Administrador','administrador','admin',true],
  ['MANAGER','Gerente','gerente','manager',true],
  ['SUPERVISOR','Supervisor','supervisor','supervisor',true],
  ['CASHIER','Caixa','caixa','cashier',true],
  ['OPERATOR','Operador de PDV','operador-pdv','operator',true],
  ['WAITER','Garçom / Atendente','garcom-atendente','waiter',true],
  ['KITCHEN','Cozinha / Produção','cozinha-producao','kitchen',true],
  ['STOCKKEEPER','Estoquista','estoquista','stockkeeper',true],
  ['PURCHASING','Compras','compras','purchasing',true],
  ['FINANCE','Financeiro','financeiro','finance',true],
  ['DELIVERY','Delivery / Expedição','delivery-expedicao','delivery',true],
  ['READ_ONLY','Consulta / Auditoria','consulta-auditoria','read-only',true]
];

const DEFAULT_PROFILES=Object.freeze(definitions.map(([key,name,slug,systemKey,protectedProfile])=>Object.freeze({
  id:DEFAULT_PROFILE_IDS[key],
  name,
  slug,
  systemKey,
  protected:protectedProfile,
  permissions:DEFAULT_PROFILE_PERMISSIONS[key]
})));

module.exports={
  STAFF_PERMISSION_IDS,
  DEFAULT_PROFILE_IDS,
  DEFAULT_PROFILE_PERMISSIONS,
  DEFAULT_PROFILES
};
