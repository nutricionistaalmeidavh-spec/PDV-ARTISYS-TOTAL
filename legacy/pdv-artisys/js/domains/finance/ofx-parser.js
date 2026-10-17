'use strict';

function tag(block,name){
  const match=String(block||'').match(new RegExp(`<${name}>([^<\\r\\n]*)`,'i'));
  return match?String(match[1]||'').trim():'';
}
function postedDate(value){
  const raw=String(value||'').trim();const compact=raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if(!compact)throw new Error('OFX possui DTPOSTED invalido.');
  const text=`${compact[1]}-${compact[2]}-${compact[3]}`;const date=new Date(`${text}T00:00:00.000Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==text)throw new Error('OFX possui data de lancamento invalida.');
  return text;
}
function amount(value){
  const normalized=String(value||'').trim().replace(',','.');const number=Number(normalized);
  if(!Number.isFinite(number))throw new Error('OFX possui TRNAMT invalido.');
  return{signed:number,cents:Math.abs(Math.round(number*100))};
}
function parseOfx(content){
  const text=String(content||'').replace(/^\uFEFF/,'');if(!text.trim())throw new Error('Arquivo OFX vazio.');
  const blocks=[...text.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|<\/OFX>)/gi)].map(match=>match[1]);
  if(!blocks.length)throw new Error('Nenhuma movimentacao STMTTRN encontrada no OFX.');
  return blocks.map((block,index)=>{
    const value=amount(tag(block,'TRNAMT'));const type=tag(block,'TRNTYPE').toUpperCase();
    const direction=value.signed<0||['DEBIT','CHECK','PAYMENT','FEE'].includes(type)?'debit':'credit';
    const name=tag(block,'NAME');const memo=tag(block,'MEMO');const description=[name,memo].filter(Boolean).filter((item,pos,arr)=>arr.indexOf(item)===pos).join(' - ')||`Movimentacao OFX ${index+1}`;
    return{date:postedDate(tag(block,'DTPOSTED')),direction,amountCents:value.cents,externalId:tag(block,'FITID')||null,description,transactionType:type||null,checkNumber:tag(block,'CHECKNUM')||null,referenceNumber:tag(block,'REFNUM')||null,rowIndex:index};
  });
}

module.exports={parseOfx};
