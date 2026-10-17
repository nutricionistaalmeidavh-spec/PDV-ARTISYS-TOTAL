function toHex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
async function hashCredential(value){const data=new TextEncoder().encode(String(value||''));const digest=await crypto.subtle.digest('SHA-256',data);return toHex(new Uint8Array(digest));}
function createCredential(bytes=32){const data=new Uint8Array(bytes);crypto.getRandomValues(data);let binary='';for(const byte of data)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function bearer(request){const value=String(request.headers.get('authorization')||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
async function authenticateRequest(request,db){const credential=bearer(request);if(!credential)return null;const hash=await hashCredential(credential);return await db.prepare('SELECT installation_id, credential_hash FROM installations WHERE credential_hash = ?').bind(hash).first();}
export{hashCredential,createCredential,bearer,authenticateRequest};
