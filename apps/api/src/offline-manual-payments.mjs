// PDV TOTAL: the cashier records tender methods manually. There is no TEF,
// bank confirmation, payment API, or acquirer state in this operation.
// Both the LAN writer and the Cloudflare replay validate the same whitelist.
export const OFFLINE_MANUAL_PAYMENT_METHODS=Object.freeze([
 'CASH','PIX','DEBIT_CARD','CREDIT_CARD'
]);
const methods=new Set(OFFLINE_MANUAL_PAYMENT_METHODS);

// Split-by-payer plans, store credit and third-party settlement have additional
// business dependencies, so remain outside the minimal offline tender workflow.
// Payments can nevertheless be mixed within one sale (e.g. CASH+PIX+CARD).
export function validOfflineManualSettlement(body){
 return Boolean(body&&typeof body==='object'&&!Array.isArray(body)&&
  Array.isArray(body.payments)&&body.payments.length>=1&&body.payments.length<=6&&
  body.payments.every(payment=>payment&&typeof payment==='object'&&!Array.isArray(payment)&&
    methods.has(payment.method)&&Number.isSafeInteger(payment.amountCents)&&
    payment.amountCents>0&&payment.amountCents<=1_000_000_000)&&
  !body.shares&&!body.customerId&&!body.storeCredit);
}
