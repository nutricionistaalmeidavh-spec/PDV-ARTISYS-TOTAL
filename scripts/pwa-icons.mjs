// Generate installable PNG icons at build time without third-party packages.
import {writeFileSync,mkdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {resolve} from 'node:path';

function crc32(data){
 let crc=0xffffffff;
 for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
function chunk(type,bytes){
 const label=Buffer.from(type),payload=Buffer.from(bytes);
 const len=Buffer.alloc(4);len.writeUInt32BE(payload.length);
 const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc32(Buffer.concat([label,payload])));
 return Buffer.concat([len,label,payload,checksum]);
}
function png(size){
 const raw=Buffer.alloc((1+size*4)*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const u=(x+.5)/size,v=(y+.5)/size;
   const circle=(u-.50)**2+(v-.5)**2<.42**2;
   const left=Math.abs(u-(.5-(v-.25)*.49))<.05;
   const right=Math.abs(u-(.5+(v-.25)*.49))<.05;
   const bar=v>.59&&v<.655&&u>.34&&u<.66;
   const glyph=circle&&v>.22&&v<.79&&(left||right||bar);
   const accent=circle&&!glyph;
   const rgb=glyph?[255,255,255]:accent?[11,108,255]:[8,26,53];
   const off=y*(1+size*4)+1+x*4;
   raw[off]=rgb[0];raw[off+1]=rgb[1];raw[off+2]=rgb[2];raw[off+3]=255;
 }
 const ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),
   chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
export function buildPwaIcons(outdir){
 const folder=resolve(outdir,'icons');mkdirSync(folder,{recursive:true});
 for(const size of [192,512])writeFileSync(resolve(folder,'pdv-total-'+size+'.png'),png(size));
}
