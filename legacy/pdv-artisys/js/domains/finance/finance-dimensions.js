'use strict';
const {randomUUID}=require('node:crypto');
const {writeAudit}=require('../../core/audit-log');
const {principalFromActor}=require('../../core/auth/principal-resolver');

function normalizeBusinessDate(value,{required=false}={}){
  if(value===null||value===undefined||value===''){
    if(required)throw new Error('Data de competencia obrigatoria.');
    return null;
  }
  const text=String(value).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new Error('Data de competencia invalida; use AAAA-MM-DD.');
  const date=new Date(`${text}T00:00:00.000Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==text)throw new Error('Data de competencia invalida.');
  return text;
}

function createFinanceDimensionsService({db,authorization=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db)throw new TypeError('Database is required.');
  const requireFinanceManage=actor=>{if(authorization)authorization.require({principal:principalFromActor(actor),capability:'finance.manage'});};
  const bool=value=>value===false||value===0?0:1;
  const text=(value,label)=>{const result=String(value||'').trim();if(!result)throw new Error(`${label} obrigatorio.`);return result;};
  const rowGroup=row=>row&&({id:row.id,name:row.name,nature:row.nature,sortOrder:Number(row.sort_order||0),active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at});
  const rowCategory=row=>row&&({id:row.id,name:row.name,kind:row.kind,dreGroupId:row.dre_group_id,active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at});
  const rowCenter=row=>row&&({id:row.id,name:row.name,active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at});
  const rowDimensions=row=>row?({entryId:row.entry_id,categoryId:row.category_id,costCenterId:row.cost_center_id,competencyDate:row.competency_date,createdAt:row.created_at,updatedAt:row.updated_at}):null;

  function listDreGroups({includeInactive=false}={}){return db.prepare(`SELECT * FROM finance_dre_groups${includeInactive?'':' WHERE active=1'} ORDER BY sort_order,name,id`).all().map(rowGroup);}
  function saveDreGroup(input={},actor=null){
    requireFinanceManage(actor);const id=String(input.id||idFactory('dre')).trim();const name=text(input.name,'Nome do grupo DRE');const nature=String(input.nature||'').toUpperCase();
    if(!['REVENUE','COST','EXPENSE','OTHER'].includes(nature))throw new Error('Natureza do grupo DRE invalida.');
    const sortOrder=Number(input.sortOrder||0);if(!Number.isInteger(sortOrder))throw new Error('Ordem do grupo DRE invalida.');
    const active=bool(input.active);const ts=now();const previous=db.prepare('SELECT created_at FROM finance_dre_groups WHERE id=?').get(id);
    db.prepare(`INSERT INTO finance_dre_groups(id,name,nature,sort_order,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,nature=excluded.nature,sort_order=excluded.sort_order,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id,name,nature,sortOrder,active,previous?.created_at||ts,ts);
    writeAudit(db,{action:'finance.dre-group.save',entity:'finance-dre-group',entityId:id,actor,context:{nature,active:Boolean(active)}},now);
    return rowGroup(db.prepare('SELECT * FROM finance_dre_groups WHERE id=?').get(id));
  }

  function listCategories({includeInactive=false}={}){return db.prepare(`SELECT * FROM financial_categories${includeInactive?'':' WHERE active=1'} ORDER BY name,id`).all().map(rowCategory);}
  function getCategory(id){return rowCategory(db.prepare('SELECT * FROM financial_categories WHERE id=?').get(String(id)));}
  function saveCategory(input={},actor=null){
    requireFinanceManage(actor);const id=String(input.id||idFactory('fcat')).trim();const name=text(input.name,'Nome da categoria');const kind=String(input.kind||'').toUpperCase();
    if(!['INCOME','EXPENSE','BOTH'].includes(kind))throw new Error('Tipo da categoria financeira invalido.');
    const dreGroupId=String(input.dreGroupId||'').trim()||null;if(dreGroupId&&!db.prepare('SELECT id FROM finance_dre_groups WHERE id=? AND active=1').get(dreGroupId))throw new Error('Grupo DRE nao encontrado ou inativo.');
    const active=bool(input.active);const ts=now();const previous=db.prepare('SELECT created_at FROM financial_categories WHERE id=?').get(id);
    db.prepare(`INSERT INTO financial_categories(id,name,kind,dre_group_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,dre_group_id=excluded.dre_group_id,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id,name,kind,dreGroupId,active,previous?.created_at||ts,ts);
    writeAudit(db,{action:'finance.category.save',entity:'financial-category',entityId:id,actor,context:{kind,dreGroupId,active:Boolean(active)}},now);
    return getCategory(id);
  }

  function listCostCenters({includeInactive=false}={}){return db.prepare(`SELECT * FROM cost_centers${includeInactive?'':' WHERE active=1'} ORDER BY name,id`).all().map(rowCenter);}
  function getCostCenter(id){return rowCenter(db.prepare('SELECT * FROM cost_centers WHERE id=?').get(String(id)));}
  function saveCostCenter(input={},actor=null){
    requireFinanceManage(actor);const id=String(input.id||idFactory('cc')).trim();const name=text(input.name,'Nome do centro de custo');const active=bool(input.active);const ts=now();const previous=db.prepare('SELECT created_at FROM cost_centers WHERE id=?').get(id);
    db.prepare(`INSERT INTO cost_centers(id,name,active,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id,name,active,previous?.created_at||ts,ts);
    writeAudit(db,{action:'finance.cost-center.save',entity:'cost-center',entityId:id,actor,context:{active:Boolean(active)}},now);
    return getCostCenter(id);
  }

  function validateEntryDimensions(input={},entryKind=null){
    const categoryId=String(input.categoryId||'').trim()||null;
    const costCenterId=String(input.costCenterId||'').trim()||null;
    if(categoryId){
      const category=db.prepare('SELECT * FROM financial_categories WHERE id=? AND active=1').get(categoryId);
      if(!category)throw new Error('Categoria financeira nao encontrada ou inativa.');
      if(entryKind==='PAYABLE'&&category.kind==='INCOME')throw new Error('Categoria de receita nao pode ser usada em conta a pagar.');
      if(entryKind==='RECEIVABLE'&&category.kind==='EXPENSE')throw new Error('Categoria de despesa nao pode ser usada em conta a receber.');
    }
    if(costCenterId&&!db.prepare('SELECT id FROM cost_centers WHERE id=? AND active=1').get(costCenterId))throw new Error('Centro de custo nao encontrado ou inativo.');
    const competencyDate=normalizeBusinessDate(input.competencyDate);
    return{categoryId,costCenterId,competencyDate};
  }

  function getEntryDimensions(entryId){return rowDimensions(db.prepare('SELECT * FROM financial_entry_dimensions WHERE entry_id=?').get(String(entryId)));}
  function setEntryDimensions(entryId,input={},actor=null){
    const entry=db.prepare('SELECT kind FROM financial_entries WHERE id=?').get(String(entryId));if(!entry)throw new Error('Lancamento financeiro nao encontrado.');
    const normalized=validateEntryDimensions(input,entry.kind);const ts=now();const previous=getEntryDimensions(entryId);
    db.prepare(`INSERT INTO financial_entry_dimensions(entry_id,category_id,cost_center_id,competency_date,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(entry_id) DO UPDATE SET category_id=excluded.category_id,cost_center_id=excluded.cost_center_id,competency_date=excluded.competency_date,updated_at=excluded.updated_at`)
      .run(String(entryId),normalized.categoryId,normalized.costCenterId,normalized.competencyDate,previous?.createdAt||ts,ts);
    writeAudit(db,{action:'finance.dimensions.update',entity:'financial-entry',entityId:String(entryId),actor,context:normalized},now);
    return getEntryDimensions(entryId);
  }

  return{listDreGroups,saveDreGroup,listCategories,getCategory,saveCategory,listCostCenters,getCostCenter,saveCostCenter,validateEntryDimensions,setEntryDimensions,getEntryDimensions};
}

module.exports={createFinanceDimensionsService,normalizeBusinessDate};
