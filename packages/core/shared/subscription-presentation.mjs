// Subscription timestamps remain UTC instants; customer-facing dates use Brasília.
export const subscriptionTimeZone='America/Sao_Paulo';
export function formatSubscriptionEnd(value){
 const date=new Date(value);
 if(!value||!Number.isFinite(date.getTime()))return 'Não informado';
 return new Intl.DateTimeFormat('pt-BR',{timeZone:subscriptionTimeZone,
  day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  .format(date)+' (Brasília)';
}
export function billingOrderLabel(status){
 return ({pending:'Pendente — aguardando pagamento',paid:'Pagamento confirmado',
  canceled:'Cancelado',expired:'Checkout expirado',refunded:'Estornado'})[status]
  ||'Status indisponível — tente atualizar';
}
