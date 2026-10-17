'use strict';
const {createHash}=require('node:crypto');
function normalizeStack(stack=''){return String(stack||'').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,'<uuid>').replace(/([A-Za-z]:\\Users\\)[^\\]+/gi,'$1<user>').replace(/(\/home\/)[^/]+/g,'$1<user>').replace(/:\d+:\d+/g,':<line>:<col>').replace(/\b\d{3,}\b/g,'<n>').replace(/\s+/g,' ').trim().slice(0,1024);}
function normalizeErrorSignature({errorClass='Error',subsystem='core',operation='unknown',stack=''}={}){return[String(errorClass).trim().toLowerCase(),String(subsystem).trim().toLowerCase(),String(operation).trim().toLowerCase(),normalizeStack(stack)].join('|');}
function fingerprintError(input={}){return`ERR-${createHash('sha256').update(normalizeErrorSignature(input)).digest('hex').slice(0,16)}`;}
module.exports={normalizeStack,normalizeErrorSignature,fingerprintError};
