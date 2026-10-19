'use strict';
// Software-only Epson/ESC-POS GS v 0 raster adapter. Logo is never uploaded
// to an external print server. Does not claim support for proprietary Star graphics.
(function(root){
 const PNG=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/i;
 async function encode(dataUrl,{paperMm=80}={}){
   if(![58,80].includes(Number(paperMm)))throw Error('Papel ESC/POS deve ser 58 ou 80 mm.');
   if(typeof dataUrl!=='string'||dataUrl.length>700000||!PNG.test(dataUrl))
     throw Error('Logotipo PNG base64 válido obrigatório.');
   if(!root.Image||!root.document?.createElement)
     throw Error('Rasterização ESC/POS requer navegador com Canvas 2D.');
   const image=new root.Image();
   image.src=dataUrl;
   if(typeof image.decode==='function')await image.decode();
   else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Falha ao decodificar PNG.'));});
   const w=Number(image.naturalWidth),h=Number(image.naturalHeight);
   if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)throw Error('Dimensões PNG inválidas.');
   const maxWidth=Number(paperMm)===58?384:576,maxHeight=192;
   const ratio=Math.min(1,maxWidth/w,maxHeight/h);
   const width=Math.max(1,Math.floor(w*ratio)),height=Math.max(1,Math.floor(h*ratio)),rowBytes=Math.ceil(width/8);
   if(width>maxWidth||height>maxHeight||rowBytes*height>14000)throw Error('Logotipo excede limite térmico.');
   const canvas=root.document.createElement('canvas');
   canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext?.('2d',{willReadFrequently:true});
   if(!ctx)throw Error('Canvas para impressão indisponível.');
   ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
   ctx.drawImage(image,0,0,width,height);
   const pixels=ctx.getImageData(0,0,width,height).data;
   const bytes=new Uint8Array(8+rowBytes*height);
   // GS v 0 m=0, width/height little-endian
   bytes.set([29,118,48,0,rowBytes&255,rowBytes>>8,height&255,height>>8],0);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
     const p=(y*width+x)*4;
     // Composite white background first, then perceptual luma threshold.
     if(299*pixels[p]+587*pixels[p+1]+114*pixels[p+2]<128000)
       bytes[8+y*rowBytes+(x>>3)]|=1<<(7-(x&7));
   }
   return bytes;
 }
 root.PdvEscposLogo=Object.freeze({encode});
})(window);
