const qty=v=>{const n=Number(v);if(!Number.isFinite(n))throw new TypeError('quantity must be finite');return n};
const text=(v,l)=>{if(typeof v!=='string'||!v.trim())throw new TypeError(`${l} is required`);return v.trim()};
const iso=(v,l)=>{const ms=Date.parse(v);if(!Number.isFinite(ms))throw new TypeError(`${l} must be a valid date`);return new Date(ms).toISOString()};
const cloneTrace=(item={})=>({lots:{...(item.lots??{})},serials:{...(item.serials??{})}});
export function createInventory(items=[]){return Object.fromEntries(items.map(i=>[String(i.sku),{sku:String(i.sku),onHand:qty(i.onHand??0),reserved:qty(i.reserved??0),...cloneTrace(i)}]))}
export function availableQuantity(item){return qty(item?.onHand??0)-qty(item?.reserved??0)}
export function applyMovement(state,{sku,delta}){sku=String(sku);const current=state[sku]??{sku,onHand:0,reserved:0,lots:{},serials:{}};return {...state,[sku]:{...current,onHand:current.onHand+qty(delta)}}}
export function reserveStock(state,sku,amount){sku=String(sku);amount=qty(amount);const current=state[sku]??{sku,onHand:0,reserved:0,lots:{},serials:{}};if(amount<0)throw new RangeError('amount must be >= 0');if(availableQuantity(current)<amount)throw new RangeError('insufficient stock');return {...state,[sku]:{...current,reserved:current.reserved+amount}}}
export function releaseStock(state,sku,amount){sku=String(sku);amount=qty(amount);const current=state[sku];if(!current||amount<0||current.reserved<amount)throw new RangeError('invalid release');return {...state,[sku]:{...current,reserved:current.reserved-amount}}}
export function createInventoryMovement({id,sku,kind,quantity,lotNumber=null,serialNumber=null,expiresAt=null,reference=null,occurredAt=new Date().toISOString(),metadata={}}={}){
  const directions={in:1,return:1,out:-1,loss:-1,adjustment:0};
  if(!(kind in directions))throw new TypeError('kind must be in, out, return, loss or adjustment');
  const amount=qty(quantity);if(amount<=0)throw new RangeError('quantity must be > 0');
  if(serialNumber!=null&&amount!==1)throw new RangeError('serialized movement quantity must be 1');
  const delta=kind==='adjustment'?0:directions[kind]*amount;
  return Object.freeze({id:text(id,'movement id'),sku:text(String(sku),'sku'),kind,quantity:amount,delta,lotNumber:lotNumber==null?null:text(String(lotNumber),'lot number'),serialNumber:serialNumber==null?null:text(String(serialNumber),'serial number'),expiresAt:expiresAt==null?null:iso(expiresAt,'expiry date'),reference,occurredAt:iso(occurredAt,'movement date'),metadata:Object.freeze({...metadata})});
}
export function applyTrackedMovement(state,movement,{adjustmentDelta=null}={}){
  const sku=String(movement.sku);const current=state[sku]??{sku,onHand:0,reserved:0,lots:{},serials:{}};
  if(movement.kind==='adjustment'&&adjustmentDelta==null)throw new TypeError('adjustmentDelta is required for adjustment movements');
  const delta=movement.kind==='adjustment'?qty(adjustmentDelta):movement.delta;
  if(current.onHand+delta<0)throw new RangeError('insufficient stock');
  const lots={...(current.lots??{})};const serials={...(current.serials??{})};
  if(movement.lotNumber){const lot=lots[movement.lotNumber]??{lotNumber:movement.lotNumber,onHand:0,expiresAt:movement.expiresAt};if(lot.onHand+delta<0)throw new RangeError('insufficient lot stock');lots[movement.lotNumber]={...lot,onHand:lot.onHand+delta,expiresAt:movement.expiresAt??lot.expiresAt??null};}
  if(movement.serialNumber){const existing=serials[movement.serialNumber];if(delta>0){if(existing?.status==='in-stock')throw new Error('serial already in stock');serials[movement.serialNumber]={serialNumber:movement.serialNumber,status:'in-stock',lotNumber:movement.lotNumber,expiresAt:movement.expiresAt,receivedAt:movement.occurredAt,issuedAt:null};}else if(delta<0){if(!existing||existing.status!=='in-stock')throw new Error('serial is not in stock');serials[movement.serialNumber]={...existing,status:movement.kind==='loss'?'lost':'issued',issuedAt:movement.occurredAt};}}
  return {...state,[sku]:{...current,onHand:current.onHand+delta,lots,serials}};
}
export function traceInventory(state,sku){const item=state[String(sku)];if(!item)return {sku:String(sku),lots:[],serials:[]};return {sku:item.sku,lots:Object.values(item.lots??{}),serials:Object.values(item.serials??{})};}
