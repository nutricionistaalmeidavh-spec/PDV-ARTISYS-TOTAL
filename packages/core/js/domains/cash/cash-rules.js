'use strict';
const { assertCents }=require('../shared/money');
const { normalizeMethod }=require('../payments/payment-rules');
function calculateCashClosing({initialCashCents=0,movements=[],countedByMethod={}}={}){
  assertCents(initialCashCents,'initialCashCents'); if(initialCashCents<0)throw new Error('Saldo inicial nao pode ser negativo.');
  const expectedByMethod={CASH:initialCashCents};
  for(const movement of movements){
    const amount=assertCents(movement.amountCents,'movement.amountCents'); if(amount<0)throw new Error('Movimento de caixa nao pode ser negativo.');
    const method=normalizeMethod(movement.paymentMethod||'CASH')||'CASH';
    const sign=movement.type==='WITHDRAWAL'||movement.type==='REVERSAL'?-1:(movement.type==='SUPPLY'||movement.type==='SALE'?1:0);
    expectedByMethod[method]=(expectedByMethod[method]||0)+(sign*amount);
  }
  const methods=new Set([...Object.keys(expectedByMethod),...Object.keys(countedByMethod||{})]);
  const counted={};const divergence={};
  for(const method of methods){const normalized=normalizeMethod(method);const value=countedByMethod[method]??countedByMethod[normalized]??0;assertCents(value,`countedByMethod.${normalized}`);counted[normalized]=value;divergence[normalized]=value-(expectedByMethod[normalized]||0);}
  const status=Object.values(divergence).some(v=>v!==0)?'divergent':'balanced';
  return {expectedByMethod,countedByMethod:counted,divergenceByMethod:divergence,expectedCashCents:expectedByMethod.CASH||0,countedCashCents:counted.CASH||0,divergenceCents:(counted.CASH||0)-(expectedByMethod.CASH||0),status};
}
module.exports={calculateCashClosing};
