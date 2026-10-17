'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PdvBusinessDate = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const DATE_PTBR = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const DATETIME_PTBR = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/;

  function pad(value) { return String(value).padStart(2,'0'); }

  function validDateParts(year,month,day) {
    const date = new Date(Date.UTC(year,month - 1,day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function localBusinessDate(value = new Date(), timeZone = null) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Data inválida.');
    const options = { year:'numeric', month:'2-digit', day:'2-digit' };
    if (timeZone) options.timeZone = String(timeZone);
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
    const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function parseCanonicalDate(value) {
    const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) throw new Error('Data inválida.');
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    if (!validDateParts(year,month,day)) throw new Error('Data inválida.');
    return {year,month,day};
  }

  function equivalentPreviousPeriod(from,to) {
    const start=parseCanonicalDate(from),end=parseCanonicalDate(to);
    const fromDate=new Date(Date.UTC(start.year,start.month-1,start.day));
    const toDate=new Date(Date.UTC(end.year,end.month-1,end.day));
    if(fromDate>toDate) throw new Error('Período inválido para comparação.');
    const days=Math.floor((toDate-fromDate)/86400000)+1;
    const previousTo=new Date(fromDate);
    previousTo.setUTCDate(previousTo.getUTCDate()-1);
    const previousFrom=new Date(previousTo);
    previousFrom.setUTCDate(previousFrom.getUTCDate()-(days-1));
    return {
      previousFrom:`${previousFrom.getUTCFullYear()}-${pad(previousFrom.getUTCMonth()+1)}-${pad(previousFrom.getUTCDate())}`,
      previousTo:`${previousTo.getUTCFullYear()}-${pad(previousTo.getUTCMonth()+1)}-${pad(previousTo.getUTCDate())}`
    };
  }

  function formatDatePtBr(value) {
    if (!String(value ?? '').trim()) return '';
    const {year,month,day}=parseCanonicalDate(value);
    return `${pad(day)}/${pad(month)}/${year}`;
  }

  function parseDatePtBr(value) {
    const text=String(value ?? '').trim();
    const match=text.match(DATE_PTBR);
    if (!match) throw new Error('Informe a data no formato dd/mm/aaaa.');
    const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]);
    if (!validDateParts(year,month,day)) throw new Error('Informe uma data válida no formato dd/mm/aaaa.');
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function formatDateTimePtBr(value) {
    const text=String(value ?? '').trim();
    if (!text) return '';
    const match=text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) throw new Error('Data e hora inválidas.');
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),hour=Number(match[4]),minute=Number(match[5]);
    if (!validDateParts(year,month,day)||hour>23||minute>59) throw new Error('Data e hora inválidas.');
    return `${pad(day)}/${pad(month)}/${year} ${pad(hour)}:${pad(minute)}`;
  }

  function parseDateTimePtBr(value) {
    const text=String(value ?? '').trim();
    const match=text.match(DATETIME_PTBR);
    if (!match) throw new Error('Informe data e hora no formato dd/mm/aaaa hh:mm.');
    const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]),hour=Number(match[4]),minute=Number(match[5]);
    if (!validDateParts(year,month,day)||hour>23||minute>59) throw new Error('Informe uma data e hora válidas no formato dd/mm/aaaa hh:mm.');
    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
  }

  return Object.freeze({ localBusinessDate,equivalentPreviousPeriod,formatDatePtBr,parseDatePtBr,formatDateTimePtBr,parseDateTimePtBr });
});
