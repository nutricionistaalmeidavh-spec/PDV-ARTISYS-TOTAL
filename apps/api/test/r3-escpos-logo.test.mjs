import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../web/r3-escpos-logo.js',import.meta.url),'utf8');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfWQAAAAASUVORK5CYII=';
function browser(){
 class MockImage{naturalWidth=2;naturalHeight=1;decode=async()=>{};set src(s){this._src=s;}}
 const root={Image:MockImage,document:{createElement(name){
   assert.equal(name,'canvas');return {width:0,height:0,getContext(type){
     assert.equal(type,'2d');return {fillStyle:'#fff',fillRect(){},drawImage(){},
       getImageData:()=>({data:Uint8Array.from([0,0,0,255,255,255,255,255])})};
   }};
 }}};
 runInNewContext(source,{window:root,Uint8Array});
 return root.PdvEscposLogo;
}
test('cap-030 R3 PNG branding raster is packed into exact ESC/POS GS v 0 row and bounded by paper width',async()=>{
 const helper=browser(),bytes=await helper.encode(PNG,{paperMm:58});
 assert.deepEqual(Array.from(bytes),[29,118,48,0,1,0,1,0,128]);
 assert.ok(bytes.length<15000);
});
test('cap-026 R3 ESC/POS raster rejects unknown image types or invalid thermal dimensions',async()=>{
 const helper=browser();
 await assert.rejects(helper.encode('data:image/svg+xml;base64,PHN2Zz4=',{paperMm:80}),/PNG/i);
 await assert.rejects(helper.encode(PNG,{paperMm:120}),/58|80/);
});
