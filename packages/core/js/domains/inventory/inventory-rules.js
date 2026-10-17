'use strict';
function roundQuantity(value) {
  const number=Number(value);
  if(!Number.isFinite(number)) throw new TypeError('Quantidade invalida.');
  return Number(number.toFixed(3));
}
function applyStockDelta(current, delta) {
  const before=roundQuantity(current); const normalizedDelta=roundQuantity(delta); const after=roundQuantity(before+normalizedDelta);
  if(after<0) throw new Error('Estoque nao pode ficar negativo.');
  return {before,after,delta:normalizedDelta};
}
module.exports={roundQuantity,applyStockDelta};
