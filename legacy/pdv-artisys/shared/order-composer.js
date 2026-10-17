'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PdvOrderComposer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const normalizedConfiguration=input=>({
    variantId:input?.variantId||null,
    selections:Array.isArray(input?.selections)?[...input.selections]:[],
    comboSelections:Array.isArray(input?.comboSelections)?clone(input.comboSelections):[],
    pizza:input?.pizza?{
      sizeId:String(input.pizza.sizeId||'')||null,
      flavorIds:Array.isArray(input.pizza.flavorIds)?input.pizza.flavorIds.map(String):[],
      crustId:String(input.pizza.crustId||'')||null
    }:null
  });
  const fractionLabel=value=>Math.abs(Number(value)-0.5)<0.000001?'½':Math.abs(Number(value)-1/3)<0.000001?'⅓':Math.abs(Number(value)-0.25)<0.000001?'¼':Number(value)===1?'':`${Math.round(Number(value||0)*100)}%`;
  function configurationSummary(configuration={}){
    const pizza=configuration?.pizza;
    if(pizza?.size?.name){
      const parts=[pizza.size.name];
      const flavors=(pizza.flavors||[]).map(flavor=>`${fractionLabel(flavor.fraction)}${fractionLabel(flavor.fraction)?' ':''}${flavor.name}`);
      if(flavors.length)parts.push(flavors.join(' + '));
      if(pizza.crust?.name)parts.push(`Borda ${pizza.crust.name}`);
      return parts.join(' · ');
    }
    const labels=[];
    if(configuration?.variant?.name)labels.push(configuration.variant.name);
    for(const option of configuration?.options||[])if(option?.name)labels.push(option.name);
    return labels.join(' · ');
  }
  function hasConfiguration(product={}){
    const config=product.configuration||product;
    return Boolean(config?.pizza?.sizes?.length||config?.variants?.length||config?.groups?.length||config?.combos?.length);
  }
  const signature=line=>JSON.stringify({
    productId:line.productId,
    note:line.note||'',
    configuration:line.configuration
  });
  function createCart({idFactory=()=>`line-${Date.now()}-${Math.random().toString(36).slice(2)}`}={}){
    let items=[];
    function add(input={}){
      const productId=String(input.productId||'').trim();
      if(!productId)throw new Error('Produto obrigatorio.');
      const quantity=Number(input.quantity??1);
      if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantidade deve ser maior que zero.');
      const configuration=normalizedConfiguration(input.configuration||input);
      const candidate={
        id:String(input.id||idFactory()),
        productId,
        name:String(input.name||productId),
        unitPriceCents:Math.max(0,Math.trunc(Number(input.unitPriceCents)||0)),
        quantity,
        note:String(input.note||'').trim().slice(0,500),
        configuration
      };
      const existing=items.find(item=>signature(item)===signature(candidate)&&item.unitPriceCents===candidate.unitPriceCents);
      if(existing){existing.quantity+=quantity;return clone(existing);}
      items.push(candidate);return clone(candidate);
    }
    function lines(){return clone(items);}
    function clear(){items=[];}
    function changeQuantity(id,delta){
      const item=items.find(row=>row.id===String(id));if(!item)return null;
      item.quantity=Number((item.quantity+Number(delta||0)).toFixed(3));
      if(item.quantity<=0){items=items.filter(row=>row!==item);return null;}
      return clone(item);
    }
    function setQuantity(id,quantity){
      const item=items.find(row=>row.id===String(id));if(!item)return null;
      const value=Number(quantity);if(!Number.isFinite(value)||value<=0){items=items.filter(row=>row!==item);return null;}
      item.quantity=value;return clone(item);
    }
    function summary(){
      return{
        lines:items.length,
        quantity:items.reduce((sum,item)=>sum+Number(item.quantity||0),0),
        totalCents:items.reduce((sum,item)=>sum+Math.round(Number(item.unitPriceCents||0)*Number(item.quantity||0)),0)
      };
    }
    function toOrderItems(){
      return items.map(item=>({
        productId:item.productId,
        quantity:item.quantity,
        variantId:item.configuration.variantId,
        selections:[...item.configuration.selections],
        comboSelections:clone(item.configuration.comboSelections),
        pizza:clone(item.configuration.pizza),
        note:item.note
      }));
    }
    return{add,lines,clear,changeQuantity,setQuantity,summary,toOrderItems};
  }
  return{createCart,hasConfiguration,configurationSummary};
});
