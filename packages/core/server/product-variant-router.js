'use strict';
const {statusForError}=require('./http-error-status');

class ProductVariantHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new ProductVariantHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ProductVariantHttpError(400,'JSON invalido.');}}

function createProductVariantRouter({runtime,installationToken='',requireTerminalAuth=false}={}){
  if(!runtime?.retail||!runtime?.catalogCustomization)throw new TypeError('runtime retail/catalog customization is required.');
  function principal(request){
    if(requireTerminalAuth){const id=String(request.headers['x-terminal-id']||'').trim();const key=String(request.headers['x-terminal-key']||'');const auth=runtime.terminals.authenticateTerminal(id,key);if(!auth.ok)throw new ProductVariantHttpError(401,'Terminal nao autorizado.');return{kind:'device',id,surface:'terminal',userId:null,terminalId:id};}
    if(installationToken&&request.headers['x-pdv-token']!==installationToken)throw new ProductVariantHttpError(401,'Token local invalido.');
    return{kind:'system',id:'system',terminalId:null};
  }
  return async function productVariantRouter(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    if(!pathname.startsWith('/api/v1/product-variants'))return false;
    try{
      const actor=principal(request);
      if(request.method==='GET'&&pathname==='/api/v1/product-variants'){
        json(response,200,runtime.retail.listProductVariants({productId:url.searchParams.get('productId')||null,query:url.searchParams.get('query')||'',includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;
      }
      if(request.method==='POST'&&pathname==='/api/v1/product-variants'){
        const data=await body(request);const product=runtime.catalog.getProduct(String(data.productId||''));if(!product)throw new ProductVariantHttpError(404,'Produto pai nao encontrado.');
        if(product.prepared){const existing=String(data.id||'')&&runtime.retail.listProductVariants({productId:product.id,includeInactive:true}).some(item=>String(item.variantId)===String(data.id));if(!existing)throw new ProductVariantHttpError(409,'Produto preparado com Ficha Tecnica nao aceita variacao de estoque. Use opcoes/adicionais.');}
        runtime.retail.prepareProductForVariants(product.id,actor);
        const priceDeltaCents=data.salePriceCents==null?Number(data.priceDeltaCents||0):Number(data.salePriceCents)-Number(product.salePriceCents||0);
        const saved=runtime.catalogCustomization.upsertVariant({...data,priceDeltaCents},actor);
        json(response,201,runtime.retail.getProductVariantStock(saved.id,{includeInactive:true}));return true;
      }
      const stock=pathname.match(/^\/api\/v1\/product-variants\/([^/]+)\/stock$/);
      if(stock&&request.method==='PUT'){const data=await body(request);json(response,200,runtime.retail.setProductVariantStock(decodeURIComponent(stock[1]),data.quantity,actor));return true;}
      const saleItems=pathname.match(/^\/api\/v1\/product-variants\/sales\/([^/]+)\/items$/);
      if(saleItems&&request.method==='POST'){json(response,200,runtime.retail.addProductVariantToSale(decodeURIComponent(saleItems[1]),await body(request),actor));return true;}
      const saleItem=pathname.match(/^\/api\/v1\/product-variants\/sales\/([^/]+)\/items\/([^/]+)$/);
      if(saleItem&&request.method==='PUT'){
        const saleId=decodeURIComponent(saleItem[1]);const itemId=decodeURIComponent(saleItem[2]);const data=await body(request);const quantity=Number(data.quantity);
        const sale=runtime.sales.getSale(saleId);const item=sale?.items?.find(entry=>entry.id===itemId);if(!item)throw new ProductVariantHttpError(404,'Item nao encontrado na venda.');
        const variantId=item.configuration?.productVariant?.id||item.configuration?.retailVariant?.id;
        if(variantId){const variant=runtime.retail.getProductVariantStock(variantId,{includeInactive:true});if(!variant.active)throw new ProductVariantHttpError(409,'Variacao inativa.');if(quantity>Number(variant.quantity||0))throw new ProductVariantHttpError(409,`Estoque insuficiente para ${variant.productName} - ${variant.name}.`);}
        json(response,200,runtime.sales.updateItemQuantityById(saleId,itemId,quantity));return true;
      }
      if(saleItem&&request.method==='DELETE'){json(response,200,runtime.sales.removeItemById(decodeURIComponent(saleItem[1]),decodeURIComponent(saleItem[2])));return true;}
      throw new ProductVariantHttpError(405,'Metodo ou rota nao permitido.');
    }catch(error){const status=statusForError(error);try{runtime.logger?.log({level:'warn',subsystem:'product-variant-http',message:error.message||'Erro interno.',context:{method:request.method,path:pathname,status}});}catch{}json(response,status,{error:error.message||'Erro interno.'});return true;}
  };
}

module.exports={createProductVariantRouter,ProductVariantHttpError};
