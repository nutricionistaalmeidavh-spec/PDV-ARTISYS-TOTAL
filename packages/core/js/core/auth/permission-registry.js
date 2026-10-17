'use strict';

const PERMISSION_GROUPS=Object.freeze({
  access:Object.freeze({id:'access',label:'Acessos e equipe'}),
  cash:Object.freeze({id:'cash',label:'Caixa'}),
  catalog:Object.freeze({id:'catalog',label:'Cadastros'}),
  finance:Object.freeze({id:'finance',label:'Financeiro e gestão'}),
  inventory:Object.freeze({id:'inventory',label:'Estoque'}),
  public:Object.freeze({id:'public',label:'Acesso público'}),
  restaurant:Object.freeze({id:'restaurant',label:'Alimentação e atacado'}),
  sales:Object.freeze({id:'sales',label:'Vendas e pós-venda'}),
  system:Object.freeze({id:'system',label:'Sistema e segurança'})
});

const DEFINITIONS=[
  ['sales.view','sales','Consultar vendas','Acessar vendas, histórico e detalhes operacionais.'],
  ['sales.create','sales','Realizar vendas','Criar e concluir vendas no PDV.'],
  ['sales.discount','sales','Aplicar descontos','Aplicar descontos permitidos durante a venda.'],
  ['sales.cancel','sales','Cancelar vendas','Cancelar vendas conforme as regras operacionais.'],
  ['returns.view','sales','Consultar devoluções','Consultar trocas e devoluções registradas.'],
  ['returns.manage','sales','Gerenciar devoluções','Criar, concluir e cancelar devoluções.'],
  ['returns.approve','sales','Autorizar devoluções','Autorizar devoluções que exigem aprovação superior.'],

  ['cash.view','cash','Consultar caixa','Consultar sessão e movimentações de caixa.'],
  ['cash.open','cash','Abrir caixa','Abrir uma sessão de caixa.'],
  ['cash.close','cash','Fechar caixa','Fechar e conferir uma sessão de caixa.'],
  ['cash.supply','cash','Realizar suprimento','Registrar entrada manual de numerário no caixa.'],
  ['cash.withdraw','cash','Realizar sangria','Registrar retirada manual de numerário do caixa.'],

  ['customers.view','catalog','Consultar clientes','Consultar cadastro e histórico disponível de clientes.'],
  ['customers.manage','catalog','Gerenciar clientes','Criar e alterar cadastros de clientes.'],
  ['products.view','catalog','Consultar produtos','Consultar produtos, preços e estrutura comercial.'],
  ['products.manage','catalog','Gerenciar produtos','Criar, editar, ativar e desativar produtos.'],
  ['suppliers.view','catalog','Consultar fornecedores','Consultar fornecedores cadastrados.'],
  ['suppliers.manage','catalog','Gerenciar fornecedores','Criar, editar, ativar e desativar fornecedores.'],
  ['sellers.view','catalog','Consultar equipe comercial','Consultar vendedores e vínculos comerciais.'],
  ['sellers.manage','catalog','Gerenciar equipe comercial','Alterar dados comerciais e regras de vendedores.'],

  ['inventory.view','inventory','Consultar estoque','Consultar saldos, movimentações e disponibilidade.'],
  ['inventory.adjust','inventory','Ajustar estoque','Registrar ajustes, contagens e correções de estoque.'],
  ['inventory.procurement','inventory','Gerenciar compras','Registrar e acompanhar entradas por compras e fornecedores.'],

  ['restaurant.access','restaurant','Acessar Alimentação','Acessar as operações do módulo Alimentação quando ele estiver ativo.'],
  ['restaurant.orders.view','restaurant','Consultar pedidos','Consultar pedidos e comandas de alimentação.'],
  ['restaurant.orders.create','restaurant','Criar pedidos','Criar pedidos em superfícies autorizadas.'],
  ['restaurant.orders.transfer','restaurant','Transferir pedidos','Transferir pedidos, comandas ou mesas conforme o fluxo operacional.'],
  ['restaurant.orders.cancel','restaurant','Cancelar itens e pedidos','Cancelar itens ou pedidos de alimentação conforme a regra operacional.'],
  ['restaurant.tables.manage','restaurant','Gerenciar mesas','Abrir, mover e administrar sessões de mesa.'],
  ['restaurant.service.request','restaurant','Solicitar atendimento','Solicitar atendimento a partir de uma mesa autorizada.'],
  ['restaurant.service.manage','restaurant','Gerenciar solicitações','Reconhecer e concluir solicitações de atendimento.'],
  ['kitchen.view','restaurant','Consultar produção','Consultar tickets e filas de produção/KDS.'],
  ['kitchen.update_status','restaurant','Atualizar produção','Atualizar estados de preparo e conclusão no KDS.'],
  ['kitchen.configure','restaurant','Configurar produção','Configurar estações e roteamento de produção.'],
  ['wholesale.access','restaurant','Acessar Atacado','Acessar as operações do módulo Atacado quando ele estiver ativo.'],
  ['wholesale.orders.manage','restaurant','Gerenciar pedidos de atacado','Criar e administrar pedidos com regras de atacado.'],

  ['finance.view','finance','Consultar financeiro','Consultar contas, lançamentos e projeções financeiras.'],
  ['finance.manage','finance','Gerenciar financeiro','Criar, liquidar, cancelar e ajustar registros financeiros.'],
  ['reports.view','finance','Consultar relatórios','Acessar relatórios operacionais e gerenciais.'],
  ['management.view','finance','Consultar gestão','Acessar indicadores e visões consolidadas do negócio.'],

  ['users.view','access','Consultar pessoas','Consultar pessoas e seus acessos.'],
  ['users.create','access','Criar pessoas com acesso','Criar usuários e habilitar acesso ao sistema.'],
  ['users.edit','access','Editar pessoas e acessos','Alterar dados e configuração de acesso de usuários.'],
  ['users.disable','access','Desativar acessos','Desativar usuários respeitando as invariantes de owner e administrador.'],
  ['users.reset_password','access','Redefinir senhas','Redefinir credenciais de acesso de outras pessoas.'],
  ['profiles.view','access','Consultar perfis','Consultar perfis de acesso e suas permissões.'],
  ['profiles.create','access','Criar perfis','Criar novos perfis de acesso.'],
  ['profiles.edit','access','Editar perfis','Alterar permissões de perfis configuráveis.'],
  ['profiles.assign','access','Atribuir perfis','Atribuir perfis de acesso às pessoas.'],
  ['profiles.delete','access','Excluir perfis','Excluir perfis que não estejam protegidos ou em uso.'],
  ['devices.view','access','Consultar dispositivos','Consultar dispositivos autorizados e seus vínculos.'],
  ['devices.pair','access','Parear dispositivos','Autorizar novos dispositivos e superfícies.'],
  ['devices.block','access','Bloquear dispositivos','Bloquear ou reativar dispositivos autorizados.'],
  ['devices.rotate_credential','access','Rotacionar credenciais','Gerar nova credencial para dispositivo autorizado.'],
  ['sessions.view','access','Consultar sessões','Consultar sessões e acessos ativos.'],
  ['sessions.revoke','access','Revogar sessões','Encerrar sessões de acesso existentes.'],

  ['public.menu.view','public','Consultar cardápio público','Consultar a projeção pública segura do cardápio para um recurso autorizado.'],
  ['public.order.create','public','Criar pedido público','Criar pedido público dentro do recurso autorizado por token opaco.'],

  ['modules.view','system','Consultar módulos','Consultar áreas habilitadas no estabelecimento.'],
  ['modules.manage','system','Gerenciar módulos','Ativar ou desativar áreas do estabelecimento.'],
  ['settings.view','system','Consultar configurações','Consultar configurações administrativas.'],
  ['settings.manage','system','Gerenciar configurações','Alterar configurações administrativas e operacionais.'],
  ['deployment.manage','system','Gerenciar implantação','Alterar o papel deste computador, servidor de dados e acesso LAN.'],
  ['security.view','system','Consultar segurança','Consultar estado de segurança, acessos e alertas.'],
  ['audit.view','system','Consultar auditoria','Consultar eventos de auditoria e alterações sensíveis.']
];

const PERMISSIONS=Object.freeze(
  DEFINITIONS
    .map(([id,group,label,description])=>Object.freeze({id,group,label,description}))
    .sort((a,b)=>a.id.localeCompare(b.id))
);

const BY_ID=new Map(PERMISSIONS.map(permission=>[permission.id,permission]));

function normalizePermissionId(value){
  return String(value||'').trim().toLowerCase();
}

function getPermissionDefinition(id){
  return BY_ID.get(normalizePermissionId(id))||null;
}

function isKnownPermission(id){
  return Boolean(getPermissionDefinition(id));
}

function listPermissions({group=null}={}){
  if(group===null||group===undefined||String(group).trim()==='')return PERMISSIONS;
  const normalized=String(group).trim().toLowerCase();
  if(!PERMISSION_GROUPS[normalized])return [];
  return PERMISSIONS.filter(permission=>permission.group===normalized);
}

module.exports={
  PERMISSION_GROUPS,
  PERMISSIONS,
  getPermissionDefinition,
  isKnownPermission,
  listPermissions,
  normalizePermissionId
};
