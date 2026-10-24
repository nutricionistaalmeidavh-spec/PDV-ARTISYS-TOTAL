import {sha256} from './password.mjs';

// Portable name-based UUID stream for replay of an already committed
// operation. Stable across Cloudflare Workers and Node SQLite. The first
// 96 bits are SHA-256-derived and the final 32 bits are a monotonic ordinal.
// v8 denotes a custom, deterministic UUID. This is NOT an authentication token.
export async function offlineMutationIds({tenantId,branchId,method,path,mutationId}){
 const basis=JSON.stringify([tenantId,branchId,method,path,mutationId]);
 const hash=await sha256(basis);
 let ordinal=0;
 return ()=>{
  if(ordinal===0xffffffff)throw new Error('Limite de IDs da operação atingido.');
  const hex=hash.slice(0,24)+(ordinal++).toString(16).padStart(8,'0');
  // UUID variant RFC 4122 + version 8 custom identifier
  const bytes=hex.slice(0,12)+'8'+hex.slice(13,16)+'8'+hex.slice(17);
  return [bytes.slice(0,8),bytes.slice(8,12),bytes.slice(12,16),bytes.slice(16,20),bytes.slice(20,32)].join('-');
 };
}
