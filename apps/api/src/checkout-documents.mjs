import profiles from '../../../packages/core/js/core/auth/default-profiles.js';
import {createCommerceService,commerceError} from './commerce.mjs';
import {planShares} from './r4-saas-rules.mjs';

const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const allowed=(member,key)=>(profiles.DEFAULT_PROFILE_PERMISSIONS[member.profileKey==='OWNER'?'ADMINISTRATOR':member.profileKey]||[]).includes(key);

// Documents remain the source of the one canonical sale. No item/stock copy is
// performed by this route; openSale already freezes and links the source once.
export async function checkoutDocumentsRoute(request,db,session,member,tenant,path){
  if(!path.startsWith('checkout/documents'))return null;
  const parts=path.split('/'),method=request.method,url=new URL(request.url);
  if(!allowed(member,'sales.create'))return json({error:'Sem permissão para operar o Balcão.'},403);
  try{
    if(Number(request.headers.get('content-length')||0)>4096)return json({error:'Dados muito grandes.'},413);
    const raw=method==='POST'?await request.text():'{}';
    if(raw.length>4096)return json({error:'Dados muito grandes.'},413);
    const body=JSON.parse(raw);
    if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Dados inválidos.'},400);
    const branch=method==='GET'?url.searchParams.get('branchId'):body.branchId;
    if(!branch||!await db.prepare('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1').bind(tenant,branch).first())
      return json({error:'Filial não encontrada.'},404);
    const q=(sql,...args)=>db.prepare(sql).bind(...args);
    if(parts.length===4&&parts[2]==='settlement'&&method==='GET'){
      const sale=await createCommerceService(db).sale(tenant,branch,decodeURIComponent(parts[3]));
      const link=await q('SELECT table_session_id AS sessionId FROM restaurant_sale_links WHERE tenant_id=? AND branch_id=? AND sale_id=?',tenant,branch,sale.id).first();
      let prepaidCents=0,shares=null;
      if(link?.sessionId){
        const payments=await q(`SELECT p.payer_index AS payerIndex,p.amount_cents-COALESCE((SELECT SUM(r.amount_cents)
          FROM r4_table_prepayment_refunds r WHERE r.tenant_id=p.tenant_id AND r.branch_id=p.branch_id AND r.prepayment_id=p.id),0) AS amountCents
          FROM r4_table_prepayments p WHERE p.tenant_id=? AND p.branch_id=? AND p.table_session_id=?`,tenant,branch,link.sessionId).all();
        prepaidCents=payments.results.reduce((sum,p)=>sum+p.amountCents,0);
        const plan=await q('SELECT parts,shares_json AS sharesJson FROM r4_split_plans WHERE tenant_id=? AND branch_id=? AND table_session_id=?',tenant,branch,link.sessionId).first();
        if(plan){
          if(sale.discountCents)return json({error:'Remova o desconto manual antes de cobrar a conta dividida.'},409);
          let expected;
          try{expected=planShares(sale.totalCents,plan.parts,plan.sharesJson?JSON.parse(plan.sharesJson):null);}
          catch{return json({error:'O valor da comanda mudou. Recalcule a divisão antes de cobrar.'},409);}
          if(payments.results.some(p=>!Number.isInteger(p.payerIndex)||p.payerIndex<1||p.payerIndex>plan.parts))
            return json({error:'Atribua cada antecipação a um pagador antes de cobrar a conta dividida.'},409);
          shares=expected.map((amount,i)=>({index:i+1,amountCents:amount-payments.results.filter(p=>p.payerIndex===i+1).reduce((sum,p)=>sum+p.amountCents,0)}));
          if(shares.some(p=>p.amountCents<0))return json({error:'Antecipação superior à parte da conta. Revise a divisão.'},409);
          shares=shares.filter(p=>p.amountCents>0);
        }
      }
      return json({settlement:{prepaidCents,amountDueCents:Math.max(0,sale.totalCents-prepaidCents),shares}});
    }
    // Settlement is a cashier task; it does not grant restaurant management.
    const food=(allowed(member,'restaurant.access')&&allowed(member,'restaurant.orders.view'))||
      (allowed(member,'sales.create')&&allowed(member,'cash.view'));
    const wholesale=allowed(member,'wholesale.access');
    if(parts.length===2&&method==='GET'){
      const query=String(url.searchParams.get('query')||'').trim().slice(0,120);
      const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      const tokens=normalize(query).split(/\s+/).filter(Boolean);
      const typeWords=new Set(['comanda','mesa','atacado','pedido','delivery','entrega','retirada']);
      const typeTokens=tokens.filter(token=>typeWords.has(token));
      const acceptsType=(...words)=>typeTokens.every(token=>words.includes(token));
      const search=tokens.filter(token=>!typeWords.has(token));
      // SQLite/D1 LOWER and LIKE only fold ASCII. Fold Portuguese accents on
      // the stored side too, including common decomposed combining marks.
      const sqlNormalize=expression=>{
        let value=expression;
        for(const [letters,replacement] of [['áàâãäåÁÀÂÃÄÅ','a'],['éèêëÉÈÊË','e'],['íìîïÍÌÎÏ','i'],['óòôõöÓÒÔÕÖ','o'],['úùûüÚÙÛÜ','u'],['çÇ','c'],['ñÑ','n']])
          for(const letter of letters)value=`REPLACE(${value},'${letter}','${replacement}')`;
        for(const mark of ['\u0300','\u0301','\u0302','\u0303','\u0308','\u0327'])value=`REPLACE(${value},'${mark}','')`;
        return `LOWER(${value})`;
      };
      const condition=expression=>search.length?` AND NOT EXISTS (SELECT 1 FROM json_each(?) search_token WHERE ${sqlNormalize(expression)} NOT LIKE search_token.value ESCAPE '\\')`:'';
      const patterns=search.map(token=>'%'+token.replace(/[\\%_]/g,c=>'\\'+c)+'%');
      const searchArgs=search.length?[JSON.stringify(patterns)]:[];
      const rows=[];
      if(food&&acceptsType('comanda','mesa')){
        const tables=await q(`SELECT s.id,'COMMAND' AS type,r.label AS label,s.status,
          l.sale_id AS saleId,COALESCE(SUM(CASE WHEN o.status='DELIVERED' THEN o.total_cents ELSE 0 END),0) AS totalCents
          FROM restaurant_table_sessions s JOIN restaurant_tables r ON r.tenant_id=s.tenant_id AND r.branch_id=s.branch_id AND r.id=s.table_id
          LEFT JOIN restaurant_sale_links l ON l.tenant_id=s.tenant_id AND l.branch_id=s.branch_id AND l.table_session_id=s.id
          LEFT JOIN sales sale ON sale.tenant_id=l.tenant_id AND sale.branch_id=l.branch_id AND sale.id=l.sale_id
          LEFT JOIN restaurant_orders o ON o.tenant_id=s.tenant_id AND o.branch_id=s.branch_id AND o.table_session_id=s.id
          WHERE s.tenant_id=? AND s.branch_id=? AND s.status IN ('OPEN','CHECKOUT')
            AND (sale.id IS NULL OR sale.status IN ('OPEN','SUSPENDED'))
            ${condition("r.label||' '||s.id")}
          GROUP BY s.id ORDER BY s.opened_at DESC LIMIT 101`,tenant,branch,...searchArgs).all();
        rows.push(...tables.results.map(row=>({...row,label:'Mesa '+row.label})));
      }
      const pickup=acceptsType('retirada'),delivery=acceptsType('delivery','entrega');
      if(food&&(pickup||delivery)){
        const orders=await q(`SELECT o.id,'DELIVERY' AS type,o.id AS label,o.status,o.fulfillment AS fulfillmentType,
          o.total_cents AS totalCents,l.sale_id AS saleId,c.name AS customerName
          FROM restaurant_orders o LEFT JOIN restaurant_sale_links l ON l.tenant_id=o.tenant_id AND l.branch_id=o.branch_id AND l.order_id=o.id
          LEFT JOIN sales sale ON sale.tenant_id=l.tenant_id AND sale.branch_id=l.branch_id AND sale.id=l.sale_id
          LEFT JOIN customers c ON c.tenant_id=o.tenant_id AND c.id=o.customer_id
          WHERE o.tenant_id=? AND o.branch_id=? AND o.fulfillment IN (${[...(pickup?["'PICKUP'"]:[]),...(delivery?["'DELIVERY'"]:[])].join(',')}) AND o.status='DELIVERED'
            AND (sale.id IS NULL OR sale.status IN ('OPEN','SUSPENDED'))
            ${condition("o.id||' '||COALESCE(c.name,'')")}
          ORDER BY o.created_at DESC LIMIT 101`,tenant,branch,...searchArgs).all();
        rows.push(...orders.results.map(row=>({...row,label:(row.fulfillmentType==='DELIVERY'?'Entrega ':'Retirada ')+row.id.slice(0,8)})));
      }
      if(wholesale&&acceptsType('atacado','pedido')){
        const orders=await q(`SELECT o.id,'ORDER' AS type,o.status,o.sale_id AS saleId,
          o.total_cents AS totalCents,c.name AS customerName,o.fulfillment AS fulfillmentType
          FROM wholesale_orders o JOIN customers c ON c.tenant_id=o.tenant_id AND c.id=o.customer_id
          LEFT JOIN sales sale ON sale.tenant_id=o.tenant_id AND sale.branch_id=o.branch_id AND sale.id=o.sale_id
          WHERE o.tenant_id=? AND o.branch_id=? AND o.status='CONFIRMED'
            AND (sale.id IS NULL OR sale.status IN ('OPEN','SUSPENDED'))
            ${condition("o.id||' '||c.name")}
          ORDER BY o.created_at DESC LIMIT 101`,tenant,branch,...searchArgs).all();
        rows.push(...orders.results.map(row=>({...row,label:'Pedido '+row.id.slice(0,8)})));
      }
      const filtered=rows.filter(row=>{
        const types={COMMAND:'comanda mesa',ORDER:'atacado pedido',DELIVERY:row.fulfillmentType==='PICKUP'?'retirada':'delivery entrega'};
        const text=normalize([row.id,row.label,row.customerName,types[row.type]].join(' '));
        return tokens.every(token=>text.includes(token));
      });
      if(filtered.length>100)return json({error:'Há mais de 100 documentos pendentes. Refine a busca por número, mesa ou cliente.'},409);
      return json({documents:filtered});
    }
    if(parts.length===5&&parts[4]==='open'&&method==='POST'){
      const type=parts[2].toUpperCase(),id=decodeURIComponent(parts[3]);
      if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(body.terminalId||''))return json({error:'Identifique o caixa antes de cobrar.'},400);
      if(!id||id.length>128)return json({error:'Documento inválido.'},400);
      if(!['COMMAND','DELIVERY','ORDER'].includes(type))return json({error:'Documento inválido.'},400);
      if(type==='ORDER'?!wholesale:!food)return json({error:'Sem permissão para consultar este documento.'},403);
      const link=type==='ORDER'?()=>q('SELECT sale_id AS saleId FROM wholesale_orders WHERE tenant_id=? AND branch_id=? AND id=?',tenant,branch,id).first():
        ()=>q('SELECT sale_id AS saleId FROM restaurant_sale_links WHERE tenant_id=? AND branch_id=? AND '+(type==='COMMAND'?'table_session_id':'order_id')+'=?',tenant,branch,id).first();
      const service=createCommerceService(db);
      let linked=await link(),sale;
      if(linked?.saleId)sale=await service.sale(tenant,branch,linked.saleId);
      else{
        const source=type==='COMMAND'?{restaurantSessionId:id}:type==='DELIVERY'?{restaurantOrderId:id}:{wholesaleOrderId:id};
        try{sale=await service.openSale(tenant,branch,session.userId,{...source,terminalId:body.terminalId},request.headers.get('x-mutation-id'));}
        catch(error){linked=await link();if(!linked?.saleId)throw error;sale=await service.sale(tenant,branch,linked.saleId);}
      }
      if(sale.terminalId!==body.terminalId)return json({error:'Este documento já está aberto em outro caixa. Continue no terminal que iniciou a cobrança.'},409);
      if(sale.status!=='OPEN')return json({error:'A venda vinculada já foi encerrada ou suspensa. Consulte o histórico ou retome-a no caixa de origem.'},409);
      const source=type==='DELIVERY'?await q('SELECT fulfillment AS fulfillmentType FROM restaurant_orders WHERE tenant_id=? AND branch_id=? AND id=?',tenant,branch,id).first():null;
      return json({sale,document:{id,type,label:(type==='COMMAND'?'Comanda ':'Pedido ')+id.slice(0,8),fulfillmentType:source?.fulfillmentType||null,status:sale.status,saleId:sale.id}});
    }
    return json({error:'Operação de documento não encontrada.'},404);
  }catch(error){
    if(error instanceof SyntaxError)return json({error:'Dados inválidos.'},400);
    const failure=commerceError(error);return json({error:failure.message},failure.status||500);
  }
}
