import {localTicketDay} from './r4-saas-rules.mjs';

export {localTicketDay as businessDay};

// Resolve calendar-day boundaries in an IANA zone. Searching for the first
// instant of the date also handles days whose midnight is skipped by DST.
export function businessDateBounds(day,timeZone){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Data inválida.');
  const anchor=Date.parse(day+'T00:00:00.000Z');
  if(!Number.isFinite(anchor)||new Date(anchor).toISOString().slice(0,10)!==day)throw Error('Data inválida.');
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  const dateAt=instant=>{
    const parts=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
    return [parts.year,parts.month,parts.day].join('-');
  };
  const start=date=>{
    const center=Date.parse(date+'T00:00:00.000Z');
    let low=center-36*3600000,high=center+36*3600000;
    while(low<high){const mid=low+Math.floor((high-low)/2);if(dateAt(mid)<date)low=mid+1;else high=mid;}
    return low;
  };
  const next=new Date(anchor+86400000).toISOString().slice(0,10);
  const beginning=start(day);
  if(dateAt(beginning)!==day)throw Error('Data inexistente neste fuso.');
  return {a:new Date(beginning).toISOString(),b:new Date(start(next)-1).toISOString()};
}
