const encoder = new TextEncoder();
const ITERATIONS = 210000;
function hex(bytes) { return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2,'0')).join(''); }
function unhex(str) {
  if (typeof str !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(str)) throw new Error('Invalid hex');
  return Uint8Array.from(str.match(/../g), pair => parseInt(pair,16));
}
export async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}
async function derive(password,salt,iterations) {
  const imported = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},imported,256));
}
export async function hashPassword(password) {
  if (typeof password!=='string' || password.length<12 || password.length>256) throw new TypeError('Password must contain 12–256 characters');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2:sha256:${ITERATIONS}:${hex(salt)}:${await derive(password,salt,ITERATIONS)}`;
}
export async function verifyPassword(password,stored) {
  if (typeof password!=='string' || password.length>256) return false;
  const parts=String(stored||'').split(':');
  if(parts.length!==5 || parts[0]!=='pbkdf2'||parts[1]!=='sha256')return false;
  const iterations=Number(parts[2]);
  if(!Number.isInteger(iterations)||iterations<150000||iterations>500000||!/^([a-f0-9]{64})$/.test(parts[4]))return false;
  let actual;
  try{actual=await derive(password,unhex(parts[3]),iterations);}catch{return false;}
  const a=unhex(actual),b=unhex(parts[4]);
  if(a.length!==b.length)return false;
  let difference=0;
  for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
  return difference===0;
}
export function newSessionToken() {return hex(crypto.getRandomValues(new Uint8Array(32)));}
