'use strict';

const CLIENT_ERROR_PATTERNS=[
  /\bobrigat[oó]ri[oa]s?\b/i,
  /\binv[aá]lid[oa]s?\b/i,
  /\binforme\b/i,
  /\bdeve(?:m)?\b/i,
  /\bn[aã]o encontrad[oa]s?\b/i,
  /\binativ[oa]s?\b/i,
  /\bsomente\b/i,
  /\bexcede\b/i,
  /\bexcedeu\b/i,
  /\bn[aã]o pertence\b/i,
  /\bn[aã]o est[aá]\b/i,
  /\bj[aá] (?:foi |est[aá] )?/i,
  /\bn[aã]o pode\b/i,
  /\bsem comanda\b/i,
  /\bindispon[ií]vel para esta opera[cç][aã]o\b/i
];
const FORBIDDEN_PATTERNS=[
  /\bpermiss[aã]o insuficiente\b/i,
  /\bsem permiss[aã]o\b/i,
  /\bautoriza[cç][aã]o .* necess[aá]ria\b/i
];
const INTERNAL_ERROR_PATTERNS=[
  /\bdisk i\/o error\b/i,
  /\bdatabase (?:is )?(?:locked|malformed|corrupt)/i,
  /\bSQLITE[_ ]/i,
  /\bECONN(?:REFUSED|RESET|ABORTED)\b/i,
  /\bEACCES\b/i,
  /\bEPERM\b/i,
  /\bENOMEM\b/i
];

function statusForError(error,{uniqueConflict=true}={}){
  const explicit=Number(error?.statusCode);
  if(Number.isInteger(explicit)&&explicit>=400&&explicit<=599)return explicit;
  if(error?.code==='MODULE_DISABLED')return 409;
  if(uniqueConflict&&/UNIQUE constraint failed/i.test(String(error?.message||'')))return 409;

  const message=String(error?.message||'');
  if(FORBIDDEN_PATTERNS.some(pattern=>pattern.test(message)))return 403;
  if(CLIENT_ERROR_PATTERNS.some(pattern=>pattern.test(message)))return 400;

  const code=String(error?.code||'');
  if(error instanceof TypeError||error instanceof ReferenceError||error instanceof SyntaxError||error instanceof RangeError)return 500;
  if(/^SQLITE_/i.test(code)||/^ERR_/i.test(code)||INTERNAL_ERROR_PATTERNS.some(pattern=>pattern.test(message)))return 500;
  return 500;
}

module.exports={statusForError};
