'use strict';

// QR Code Version 4-L (33x33, 80 data + 20 ECC codewords), byte mode.
// This intentionally supports short local-LAN URLs only and requires no cloud/CDN dependency.
const VERSION=4;
const SIZE=33;
const DATA_CODEWORDS=80;
const ECC_CODEWORDS=20;

function gfMul(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);if(((y>>>i)&1)!==0)z^=x;}return z&0xff;}
function generator(degree){let result=new Uint8Array(degree);result[degree-1]=1;let root=1;for(let i=0;i<degree;i++){for(let j=0;j<degree;j++){result[j]=gfMul(result[j],root);if(j+1<degree)result[j]^=result[j+1];}root=gfMul(root,0x02);}return result;}
function ecc(data){const divisor=generator(ECC_CODEWORDS);const rem=new Uint8Array(ECC_CODEWORDS);for(const byte of data){const factor=byte^rem[0];rem.copyWithin(0,1);rem[ECC_CODEWORDS-1]=0;for(let i=0;i<ECC_CODEWORDS;i++)rem[i]^=gfMul(divisor[i],factor);}return rem;}
function appendBits(bits,value,length){for(let i=length-1;i>=0;i--)bits.push((value>>>i)&1);}
function encodePayload(text){const bytes=Buffer.from(String(text),'utf8');if(bytes.length>78)throw new Error('URL local excede a capacidade do QR interno.');const bits=[];appendBits(bits,0x4,4);appendBits(bits,bytes.length,8);for(const byte of bytes)appendBits(bits,byte,8);const capacity=DATA_CODEWORDS*8;appendBits(bits,0,Math.min(4,capacity-bits.length));while(bits.length%8)bits.push(0);const data=[];for(let i=0;i<bits.length;i+=8){let value=0;for(let j=0;j<8;j++)value=(value<<1)|bits[i+j];data.push(value);}for(let pad=0;data.length<DATA_CODEWORDS;pad++)data.push(pad%2===0?0xec:0x11);const block=Uint8Array.from(data);return Uint8Array.from([...block,...ecc(block)]);}
function formatBits(mask){const eccLevel=1;let data=(eccLevel<<3)|mask;let rem=data<<10;for(let i=14;i>=10;i--)if(((rem>>>i)&1)!==0)rem^=0x537<<(i-10);return((data<<10)|(rem&0x3ff))^0x5412;}
function makeMatrix(payload){
  const modules=Array.from({length:SIZE},()=>Array(SIZE).fill(false));
  const functionCell=Array.from({length:SIZE},()=>Array(SIZE).fill(false));
  const set=(x,y,dark=true)=>{if(x>=0&&y>=0&&x<SIZE&&y<SIZE){modules[y][x]=Boolean(dark);functionCell[y][x]=true;}};
  function finder(cx,cy){for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=SIZE||y>=SIZE)continue;const dist=Math.max(Math.abs(dx),Math.abs(dy));set(x,y,dist!==2&&dist!==4);}}
  finder(3,3);finder(SIZE-4,3);finder(3,SIZE-4);
  for(let i=0;i<SIZE;i++){if(!functionCell[6][i])set(i,6,i%2===0);if(!functionCell[i][6])set(6,i,i%2===0);}
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(26+dx,26+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  // Reserve format regions before placing data.
  for(let i=0;i<=5;i++)set(8,i,false);set(8,7,false);set(8,8,false);set(7,8,false);for(let i=9;i<15;i++)set(14-i,8,false);
  for(let i=0;i<8;i++)set(SIZE-1-i,8,false);for(let i=8;i<15;i++)set(8,SIZE-15+i,false);set(8,SIZE-8,true);
  const codewords=encodePayload(payload);const dataBits=[];for(const byte of codewords)appendBits(dataBits,byte,8);let bitIndex=0;let upward=true;
  for(let right=SIZE-1;right>=1;right-=2){if(right===6)right--;for(let vert=0;vert<SIZE;vert++){const y=upward?SIZE-1-vert:vert;for(let j=0;j<2;j++){const x=right-j;if(functionCell[y][x])continue;let dark=bitIndex<dataBits.length?Boolean(dataBits[bitIndex++]):false;if((x+y)%2===0)dark=!dark;modules[y][x]=dark;}}upward=!upward;}
  const fmt=formatBits(0);const bit=i=>((fmt>>>i)&1)!==0;
  for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));for(let i=9;i<15;i++)set(14-i,8,bit(i));
  for(let i=0;i<8;i++)set(SIZE-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,SIZE-15+i,bit(i));set(8,SIZE-8,true);
  return modules;
}
function escapeXml(value){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));}
function qrSvg(payload,{scale=6,border=4}={}){const matrix=makeMatrix(payload);const side=SIZE+border*2;const rects=[];for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)if(matrix[y][x])rects.push(`<rect x="${x+border}" y="${y+border}" width="1" height="1"/>`);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side*scale}" height="${side*scale}" shape-rendering="crispEdges" data-qr-payload="${escapeXml(payload)}"><rect width="100%" height="100%" fill="white"/><g fill="black">${rects.join('')}</g></svg>`;}

module.exports={qrSvg,makeMatrix,encodePayload,VERSION,SIZE};
