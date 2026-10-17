'use strict';

const {randomUUID}=require('node:crypto');
const {withTransaction}=require('../../core/database/sqlite-database');
const {writeAudit}=require('../../core/audit-log');
const {assertCents}=require('../shared/money');

const APPOINTMENT_TRANSITIONS={SCHEDULED:['IN_PROGRESS','CANCELLED','NO_SHOW'],IN_PROGRESS:['COMPLETED','CANCELLED'],COMPLETED:[],CANCELLED:[],NO_SHOW:[]};
function text(value,label){const out=String(value||'').trim();if(!out)throw new Error(`${label} obrigatorio.`);return out;}
function bps(value,label='Comissao'){const n=Number(value??0);if(!Number.isInteger(n)||n<0||n>10000)throw new Error(`${label} invalida.`);return n;}
function isoPlusMinutes(value,minutes){const date=new Date(String(value));if(Number.isNaN(date.getTime()))throw new Error('Data/hora do atendimento invalida.');return new Date(date.getTime()+minutes*60000).toISOString();}

function createServicesService({db,modules,catalog,sales,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules||!catalog||!sales)throw new TypeError('db, modules, catalog and sales are required.');
  const gate=()=>modules.requireEnabled('SERVICES');

  function mapService(row){return row&&{id:row.id,productId:row.product_id,name:row.name,durationMinutes:row.duration_minutes,priceCents:row.price_cents,active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at};}
  function getService(id){gate();const row=db.prepare('SELECT * FROM service_catalog WHERE id=?').get(String(id));if(!row)throw new Error('Servico nao encontrado.');return mapService(row);}
  function listServices(){gate();return db.prepare('SELECT * FROM service_catalog WHERE active=1 ORDER BY name,id').all().map(mapService);}
  function upsertService(input={},actor={}){
    gate();const id=String(input.id||idFactory('service')).trim();const name=text(input.name,'Nome do servico');const duration=Number(input.durationMinutes);if(!Number.isInteger(duration)||duration<=0||duration>1440)throw new Error('Duracao do servico invalida.');const price=assertCents(Number(input.priceCents??0),'priceCents');if(price<0)throw new Error('Preco do servico invalido.');
    const existing=db.prepare('SELECT product_id FROM service_catalog WHERE id=?').get(id);const productId=existing?.product_id||`__artisys_service_${id}`;const ts=now();
    catalog.upsertProduct({id:productId,name:`Servico: ${name}`,salePriceCents:price,costCents:0,trackStock:false,unit:'UN',active:input.active!==false},actor);
    db.prepare(`INSERT INTO service_catalog(id,product_id,name,duration_minutes,price_cents,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,duration_minutes=excluded.duration_minutes,price_cents=excluded.price_cents,active=excluded.active,updated_at=excluded.updated_at`).run(id,productId,name,duration,price,input.active===false?0:1,ts,ts);
    writeAudit(db,{action:'services.service.upsert',entity:'service',entityId:id,actor,context:{name,durationMinutes:duration,priceCents:price}},now);return getService(id);
  }

  function mapProfessional(row){return row&&{id:row.id,name:row.name,defaultCommissionBps:row.default_commission_bps,active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at};}
  function getProfessional(id){gate();const row=db.prepare('SELECT * FROM service_professionals WHERE id=?').get(String(id));if(!row)throw new Error('Profissional nao encontrado.');return mapProfessional(row);}
  function listProfessionals(){gate();return db.prepare('SELECT * FROM service_professionals WHERE active=1 ORDER BY name,id').all().map(mapProfessional);}
  function upsertProfessional(input={},actor={}){
    gate();const id=String(input.id||idFactory('professional')).trim();const name=text(input.name,'Nome do profissional');const commission=bps(input.defaultCommissionBps);const ts=now();
    db.prepare(`INSERT INTO service_professionals(id,name,default_commission_bps,active,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,default_commission_bps=excluded.default_commission_bps,active=excluded.active,updated_at=excluded.updated_at`).run(id,name,commission,input.active===false?0:1,ts,ts);
    writeAudit(db,{action:'services.professional.upsert',entity:'service_professional',entityId:id,actor,context:{name,commissionBps:commission}},now);return getProfessional(id);
  }

  function linkProfessional(serviceId,professionalId,input={},actor={}){
    gate();const service=getService(serviceId);const professional=getProfessional(professionalId);if(!service.active||!professional.active)throw new Error('Servico ou profissional inativo.');const commission=input.commissionBps==null?professional.defaultCommissionBps:bps(input.commissionBps);const ts=now();
    db.prepare(`INSERT INTO service_professional_links(service_id,professional_id,commission_bps,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(service_id,professional_id) DO UPDATE SET commission_bps=excluded.commission_bps,updated_at=excluded.updated_at`).run(service.id,professional.id,commission,ts);
    writeAudit(db,{action:'services.professional.link',entity:'service',entityId:service.id,actor,context:{professionalId:professional.id,commissionBps:commission}},now);return{serviceId:service.id,professionalId:professional.id,commissionBps:commission};
  }

  function mapAppointment(row){return row&&{id:row.id,serviceId:row.service_id,professionalId:row.professional_id,customerId:row.customer_id,startsAt:row.starts_at,endsAt:row.ends_at,status:row.status,note:row.note,saleId:row.sale_id,commissionBps:row.commission_bps,createdAt:row.created_at,updatedAt:row.updated_at};}
  function getAppointment(id){gate();const row=db.prepare('SELECT * FROM service_appointments WHERE id=?').get(String(id));if(!row)throw new Error('Atendimento nao encontrado.');return mapAppointment(row);}
  function scheduleAppointment(input={},actor={}){
    gate();const service=getService(input.serviceId);const professional=getProfessional(input.professionalId);const link=db.prepare('SELECT commission_bps FROM service_professional_links WHERE service_id=? AND professional_id=?').get(service.id,professional.id);if(!link)throw new Error('Profissional nao esta vinculado ao servico.');if(input.customerId&&!catalog.getCustomer(input.customerId))throw new Error('Cliente nao encontrado.');
    const startsAt=new Date(String(input.startsAt));if(Number.isNaN(startsAt.getTime()))throw new Error('Data/hora do atendimento invalida.');const start=startsAt.toISOString();const end=isoPlusMinutes(start,service.durationMinutes);
    const conflict=db.prepare(`SELECT id FROM service_appointments WHERE professional_id=? AND status NOT IN('CANCELLED','NO_SHOW') AND starts_at<? AND ends_at>? LIMIT 1`).get(professional.id,end,start);if(conflict)throw new Error('Conflito de agenda para o profissional.');
    const id=String(input.id||idFactory('appointment'));const ts=now();db.prepare(`INSERT INTO service_appointments(id,service_id,professional_id,customer_id,starts_at,ends_at,status,note,sale_id,commission_bps,created_at,updated_at) VALUES(?,?,?,?,?,?,'SCHEDULED',?,NULL,?,?,?)`).run(id,service.id,professional.id,input.customerId||null,start,end,String(input.note||'').trim()||null,link.commission_bps,ts,ts);
    writeAudit(db,{action:'services.appointment.create',entity:'service_appointment',entityId:id,actor,context:{serviceId:service.id,professionalId:professional.id,startsAt:start,endsAt:end}},now);return getAppointment(id);
  }

  function updateAppointmentStatus(id,status,actor={}){
    gate();const appointment=getAppointment(id);const next=String(status||'').toUpperCase();if(!(APPOINTMENT_TRANSITIONS[appointment.status]||[]).includes(next))throw new Error(`Transicao de atendimento invalida: ${appointment.status} -> ${next}.`);
    db.prepare('UPDATE service_appointments SET status=?,updated_at=? WHERE id=?').run(next,now(),appointment.id);writeAudit(db,{action:'services.appointment.status',entity:'service_appointment',entityId:appointment.id,actor,context:{from:appointment.status,to:next}},now);return getAppointment(appointment.id);
  }

  function createSale(id,input={},actor={}){
    gate();const appointment=getAppointment(id);if(appointment.saleId)return sales.getSale(appointment.saleId);if(appointment.status!=='COMPLETED')throw new Error('Atendimento deve estar concluido para gerar venda.');const terminalId=text(input.terminalId,'Terminal');const operatorId=text(input.operatorId,'Operador');const service=getService(appointment.serviceId);
    return withTransaction(db,()=>{const sale=sales.openSale({terminalId,operatorId,customerId:appointment.customerId||null},actor);sales.addItem(sale.id,{productId:service.productId,quantity:1,unitPriceCents:service.priceCents,configurationSnapshot:{version:1,service:{id:service.id,name:service.name,appointmentId:appointment.id,professionalId:appointment.professionalId,commissionBps:appointment.commissionBps}},forceSeparateLine:true});for(const item of Array.isArray(input.extraItems)?input.extraItems:[])sales.addItem(sale.id,item);db.prepare('UPDATE service_appointments SET sale_id=?,updated_at=? WHERE id=?').run(sale.id,now(),appointment.id);writeAudit(db,{action:'services.appointment.sale',entity:'service_appointment',entityId:appointment.id,actor,context:{saleId:sale.id}},now);return sales.getSale(sale.id);});
  }

  function commissionReport({from=null,to=null,professionalId=null}={}){
    gate();const clauses=["a.status='COMPLETED'","s.status='COMPLETED'"];const params=[];if(from){clauses.push('s.completed_at>=?');params.push(String(from));}if(to){clauses.push('s.completed_at<=?');params.push(String(to));}if(professionalId){clauses.push('a.professional_id=?');params.push(String(professionalId));}
    const rows=db.prepare(`SELECT a.id AS appointmentId,a.professional_id AS professionalId,pr.name AS professionalName,a.commission_bps AS commissionBps,sc.id AS serviceId,sc.name AS serviceName,si.total_cents AS serviceTotalCents,s.id AS saleId,s.completed_at AS completedAt
      FROM service_appointments a JOIN service_catalog sc ON sc.id=a.service_id JOIN service_professionals pr ON pr.id=a.professional_id JOIN sales s ON s.id=a.sale_id JOIN sale_items si ON si.sale_id=s.id AND si.product_id=sc.product_id
      WHERE ${clauses.join(' AND ')} ORDER BY s.completed_at,a.id`).all(...params).map(row=>({...row,commissionCents:Math.round(row.serviceTotalCents*row.commissionBps/10000)}));
    return{rows,totalServiceCents:rows.reduce((sum,row)=>sum+row.serviceTotalCents,0),totalCommissionCents:rows.reduce((sum,row)=>sum+row.commissionCents,0)};
  }

  return{upsertService,getService,listServices,upsertProfessional,getProfessional,listProfessionals,linkProfessional,scheduleAppointment,getAppointment,updateAppointmentStatus,createSale,commissionReport,APPOINTMENT_TRANSITIONS};
}

module.exports={createServicesService,APPOINTMENT_TRANSITIONS};
