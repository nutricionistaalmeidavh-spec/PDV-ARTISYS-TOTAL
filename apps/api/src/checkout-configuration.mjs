// D1 adapter for the SAME catalog product and sale line. Pricing and group
// constraints parallel the desktop's catalog-customization-service contract.
// No client-supplied price is accepted; every checkout freezes its own snapshot.
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const capped=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
const cents=v=>Number.isSafeInteger(v)&&v>=0&&v<=1_000_000;
const entry=(v,label)=>{
  if(!v||!identifier(v.id)||!capped(v.name,120)||!cents(v.priceDeltaCents))
    throw new Error(label+' inválido: informe ID, nome e acréscimo não negativo em centavos.');
  return {id:v.id,name:capped(v.name,120),priceDeltaCents:v.priceDeltaCents};
};
export function validateCheckoutConfig(raw={},error=(status,message)=>Object.assign(new Error(message),{status})){
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Array.isArray(raw.variants)||!Array.isArray(raw.groups)||
    raw.variants.length>20||raw.groups.length>12)
    throw new Error('Configuração excede os limites ou falta catálogo.');
  const seen=new Set();
  const unique=(id)=>{if(seen.has(id))throw new Error('IDs de configuração duplicados.');seen.add(id);};
  const variants=raw.variants.map(v=>{const result=entry(v,'Variação');unique(result.id);return result;});
  let totalOptions=0;
  const groups=raw.groups.map(g=>{
    if(!identifier(g?.id)||!capped(g.name,120)||!['SINGLE','MULTIPLE'].includes(g.selectionType)||
      !Number.isSafeInteger(g.minSelections)||!Number.isSafeInteger(g.maxSelections)||
      g.minSelections<0||g.maxSelections<1||g.minSelections>g.maxSelections||
      g.maxSelections>20||(g.selectionType==='SINGLE'&&g.maxSelections!==1)||
      !Array.isArray(g.options)||g.options.length>25)
      throw new Error('Grupo de adicionais inválido.');
    unique(g.id);
    const options=g.options.map(opt=>{const v=entry(opt,'Adicional');unique(v.id);totalOptions++;return v;});
    if(g.minSelections>options.length||g.maxSelections>options.length)
      throw new Error('Seleções obrigatórias excedem opções do grupo.');
    return {id:g.id,name:capped(g.name,120),selectionType:g.selectionType,
      minSelections:g.minSelections,maxSelections:g.maxSelections,required:g.minSelections>0,options};
  });
  if(totalOptions>80)throw new Error('Máximo de 80 adicionais por produto.');
  const doc={version:1,variants,groups,combos:[]};
  if(JSON.stringify(doc).length>24000)throw new Error('Configuração maior que 24 KB.');
  return doc;
 }catch(e){throw error(400,e.message);}
}
export function priceCheckoutConfiguration(config,basePriceCents,input={},error=(status,message)=>Object.assign(new Error(message),{status})){
 const fail=message=>{throw error(400,message);};
 if(!cents(basePriceCents)&&!(Number.isSafeInteger(basePriceCents)&&basePriceCents<=1_000_000_000&&basePriceCents>=0))
   fail('Preço de catálogo inválido.');
 if(input.comboSelections?.length||input.pizza)fail('Combos e pizzas especializadas exigem validação operacional própria.');
 const id=input.variantId||null;
 if(config.variants.length&&!id)fail('Selecione a variação.');
 const variant=id?config.variants.find(v=>v.id===id):null;
 if(id&&!variant)fail('Variação não pertence ao produto.');
 const selections=input.selections??[];
 if(!Array.isArray(selections)||selections.length>80||
   selections.some(v=>typeof v!=='string')||new Set(selections).size!==selections.length)
   fail('Seleções repetidas ou inválidas.');
 let price=basePriceCents;
 if(variant)price+=variant.priceDeltaCents;
 const options=[];
 for(const group of config.groups){
   const found=group.options.filter(o=>selections.includes(o.id));
   if(found.length<group.minSelections||found.length>group.maxSelections)
     fail('Selecione entre '+group.minSelections+' e '+group.maxSelections+' adicional(is) em '+group.name+'.');
   for(const option of found){
     price+=option.priceDeltaCents;
     options.push({id:option.id,groupId:group.id,groupName:group.name,
       name:option.name,priceDeltaCents:option.priceDeltaCents});
   }
 }
 if(options.length!==selections.length)fail('Adicional não pertence ao produto.');
 if(!Number.isSafeInteger(price)||price<0||price>1_000_000_000)fail('Preço configurado inválido.');
 return {unitPriceCents:price,
   configurationSnapshot:{version:1,variant:variant?{...variant}:null,options,
     comboSelections:[]}};
}
export function createCheckoutConfigurationService({q,first,batch,applied,audit,stamp,branchExists,product,requiredMutation,error}){
 async function config(t,b,id){
   await branchExists(t,b);
   await product(t,id);
   const row=await first('SELECT config_json AS json FROM checkout_product_configurations WHERE tenant_id=? AND product_id=?',t,id);
   const value=row?JSON.parse(row.json):{version:1,groups:[],variants:[],combos:[]};
   return {...value,productId:id};
 }
 return {
   configuration:config,
   async save(t,b,id,body,key){
     await branchExists(t,b);
     const productRow=await product(t,id);
     const mutation=requiredMutation(body,key),scope='product.configuration:'+b+':'+id;
     const prev=await applied(t,scope,mutation);
     if(prev)return prev;
     const normalized=validateCheckoutConfig(body,error);
     const result={...normalized,productId:productRow.id};
     await batch([
       q(`INSERT INTO checkout_product_configurations(tenant_id,product_id,config_json,created_at,updated_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(tenant_id,product_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at`,
         t,id,JSON.stringify(normalized),stamp(),stamp()),
       audit(t,scope,mutation,result)
     ]);
     return result;
   },
   async quote(t,b,id,body){
     const productRow=await product(t,id);
     const current=await config(t,b,id);
     const quote=priceCheckoutConfiguration(current,productRow.sale_price_cents,body,error);
     return {...quote,productId:id};
   }
 };
}
