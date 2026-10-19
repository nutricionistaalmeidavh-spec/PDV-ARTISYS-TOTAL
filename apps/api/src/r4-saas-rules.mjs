// Deterministic SaaS domain rules. Monetary values never use floats.
export function planShares(totalCents,parts,requested=null){
 if(!Number.isSafeInteger(totalCents)||totalCents<=0||!Number.isInteger(parts)||parts<2||parts>50)
  throw Error('Número de parcelas ou valor inválido.');
 if(requested!==null&&requested!==undefined){
  if(!Array.isArray(requested)||requested.length!==parts)throw Error('Informe uma parcela para cada pagador.');
  if(requested.some(n=>!Number.isSafeInteger(n)||n<=0))throw Error('Cada parcela precisa de valor inteiro positivo.');
  if(requested.reduce((a,b)=>a+b,0)!==totalCents)throw Error('Soma das parcelas deve corresponder exatamente à conta.');
  return [...requested];
 }
 const each=Math.floor(totalCents/parts),remain=totalCents%parts;
 if(each<=0)throw Error('Número de parcelas excede valor da conta.');
 return Array.from({length:parts},(_,i)=>each+(i<remain?1:0));
}
export function localTicketDay(instant,timeZone='America/Sao_Paulo'){
 if(typeof timeZone!=='string'||timeZone.length>64)throw Error('Fuso horário inválido.');
 const date=new Date(instant);
 if(!Number.isFinite(date.getTime()))throw Error('Data inválida.');
 let fmt;
 try{fmt=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});}
 catch{throw Error('Fuso horário inválido.');}
 const parts=Object.fromEntries(fmt.formatToParts(date).filter(p=>['year','month','day'].includes(p.type)).map(p=>[p.type,p.value]));
 return [parts.year,parts.month,parts.day].join('-');
}
export function ean13CheckDigit(first12){
 if(typeof first12!=='string'||!/^[0-9]{12}$/.test(first12))throw Error('EAN13 requer 12 dígitos.');
 let sum=0;for(let i=0;i<12;i++)sum+=Number(first12[i])*(i%2?3:1);
 return String((10-sum%10)%10);
}
export function parseWeightedEAN13(barcode){
 if(typeof barcode!=='string'||!/^[0-9]{13}$/.test(barcode))throw Error('Etiqueta de peso precisa conter 13 dígitos.');
 if(!/^2[0-9]/.test(barcode))throw Error('Prefixo de etiqueta de balança inválido.');
 if(ean13CheckDigit(barcode.slice(0,12))!==barcode[12])throw Error('Dígito de verificação EAN13 inválido.');
 const grams=Number(barcode.slice(7,12));
 if(!Number.isSafeInteger(grams)||grams<1)throw Error('Peso de etiqueta inválido.');
 return {barcode,prefix:barcode.slice(0,2),plu:barcode.slice(2,7),grams};
}
