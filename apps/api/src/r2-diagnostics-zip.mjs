// Pure-JS, dependency-free stored ZIP for the local support bundle.
// Keep an allowlist: diagnostics must not include user, credentials or raw SQLite.
const enc=new TextEncoder();
const table=new Uint32Array(256);
for(let n=0;n<256;n++){
  let crc=n;
  for(let j=0;j<8;j++)crc=(crc&1)?(0xedb88320^(crc>>>1)):(crc>>>1);
  table[n]=crc>>>0;
}
const crc32=data=>{
  let crc=0xffffffff;
  for(const byte of data)crc=table[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
};
const u16=(v,n,x)=>v.setUint16(n,x,true),u32=(v,n,x)=>v.setUint32(n,x>>>0,true);
function stamp(date){
  const d=new Date(date);
  const y=Math.max(1980,Math.min(2107,d.getUTCFullYear()));
  return {time:(d.getUTCHours()<<11)|(d.getUTCMinutes()<<5)|(d.getUTCSeconds()>>>1),
    day:((y-1980)<<9)|((d.getUTCMonth()+1)<<5)|d.getUTCDate()};
}
function combine(parts){
  const total=parts.reduce((n,item)=>n+item.length,0);
  const out=new Uint8Array(total);let offset=0;
  for(const p of parts){out.set(p,offset);offset+=p.length;}
  return out;
}
export function zipJsonEntries(payloads,date=new Date().toISOString()){
  if(!payloads||typeof payloads!=='object'||Object.keys(payloads).length>20)
    throw Error('Invalid diagnostic bundle.');
  const local=[],central=[],ts=stamp(date);let offset=0;
  for(const [filename,value] of Object.entries(payloads)){
    if(!/^[a-z0-9-]+\.json$/.test(filename))throw Error('Invalid support entry.');
    const name=enc.encode(filename),data=enc.encode(JSON.stringify(value,null,2)+'\n');
    if(data.length>1024*256)throw Error('Diagnostic entry too large.');
    const checksum=crc32(data),head=new Uint8Array(30),h=new DataView(head.buffer);
    u32(h,0,0x04034b50);u16(h,4,20);u16(h,6,0x800);u16(h,10,ts.time);u16(h,12,ts.day);
    u32(h,14,checksum);u32(h,18,data.length);u32(h,22,data.length);u16(h,26,name.length);
    local.push(head,name,data);
    const dir=new Uint8Array(46),v=new DataView(dir.buffer);
    u32(v,0,0x02014b50);u16(v,4,20);u16(v,6,20);u16(v,8,0x800);
    u16(v,12,ts.time);u16(v,14,ts.day);u32(v,16,checksum);u32(v,20,data.length);
    u32(v,24,data.length);u16(v,28,name.length);u32(v,42,offset);
    central.push(dir,name);
    offset+=head.length+name.length+data.length;
  }
  const count=Object.keys(payloads).length;
  const mid=combine(central),end=new Uint8Array(22),v=new DataView(end.buffer);
  u32(v,0,0x06054b50);u16(v,8,count);u16(v,10,count);u32(v,12,mid.length);u32(v,16,offset);
  return combine([...local,mid,end]);
}
