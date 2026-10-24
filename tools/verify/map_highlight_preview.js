// map_highlight_preview.js — КАК БУДЕТ ВЫГЛЯДЕТЬ ПОДСВЕТКА КАРТЫ, ЕСЛИ СВЕСТИ ЕЁ В ОДИН СЛОТ.
// Решение по ВИДУ принимается ДО правки конвейера спрайтов, поэтому «сплошной» вариант здесь
// не собирается в ROM, а МОДЕЛИРУЕТСЯ из живого фреймбуфера: подсветка карты — это
// единственное, что лежит в плоскости p2 (карта-спрайты идут в p2, см. vec_pal_menu; фон
// пергамента и шейпы живут в p0/p1), поэтому «замещение вместо OR» = у каждого пикселя с
// p2=1 погасить p0 и p1. Результат — вся обводка в idx2, ровно как даст правка.
// Рисуем обе версии в ТРЁХ фазах мерцания (чёрный / 0x056 / 0x076 = MSX 1/6/0A) плюс
// крупный план обводки.
// Запуск: node tools/verify/map_highlight_preview.js [rom] [sym] [выходной.png]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||ROM.replace(/\.rom$/,".sym");
const OUT=process.argv[4]||T+"/../../build/map_highlight_preview.png";
const E=make(ROM,SYM);
const {L,rd,run,key,memory,io,pngFrom}=E;
const onMap=()=>rd(L.vec_brillo_pal)===0x0C3 &&
  (rd(L.vec_brillo_pal+1)|(rd(L.vec_brillo_pal+2)<<8))===L.vbp_map;
if(toGame(E)!==5){console.log("нет геймплея");process.exit(2);}
// дойти до карты долины читом H и дождаться, пока пергамент нарисован
key(72,1);run(4);key(72,0);
let ok=false;
for(let i=0;i<2500;i++){run(1);
  if(onMap()){let n=0;for(let k=0;k<8192;k++)if(memory.bytes[memory.tobank(0xC000+k)])n++;
    if(n>4){ok=true;break;}}}
if(!ok){console.log("карту долины поймать не удалось");process.exit(2);}
run(30);
// --- снять плоскости ---
const b=memory.bytes,tb=a=>memory.tobank(a);
const P0=new Uint8Array(8192),P1=new Uint8Array(8192),P2=new Uint8Array(8192);
for(let i=0;i<8192;i++){P0[i]=b[tb(0x8000+i)];P1[i]=b[tb(0xA000+i)];P2[i]=b[tb(0xC000+i)];}
const pal=Array.from(io.Palette);
// фазы мерцания подсветки (Vector-байты) -> RGB тем же законом, что в io.commit_palette
const PH=[0x057,0x056,0x076];   // цикл после снятия чёрной фазы (решение владельца)
const toRGB=w8=>{const bb=(w8&0xc0)>>6,g=(w8&0x38)>>3,r=(w8&0x07);
  return (0xff000000|(bb<<(6+16))|(g<<(5+8))|(r<<(5+0)))>>>0;};
// --- рендер кадра из плоскостей ---
const W=576,H=288;
function render(p0,p1,p2,palette){
  const out=new Uint32Array(W*H);
  for(let r=0;r<256;r++){
    const lo=(31-r)&255, sy=r+16;
    for(let col=0;col<32;col++){
      const a=col*256+lo;
      for(let k=7;k>=0;k--){
        const idx=(((p0[a]>>k)&1)<<3)|(((p1[a]>>k)&1)<<2)|(((p2[a]>>k)&1)<<1);
        const sx=(col*8+(7-k))*2+32,c=palette[idx];
        out[sy*W+sx]=c;out[sy*W+sx+1]=c;
      }
    }
  }
  return out;
}
// «сплошная»: где p2=1 — гасим p0 и p1 (замещение вместо OR) => вся обводка в idx2
const S0=new Uint8Array(P0),S1=new Uint8Array(P1);
let hl=0;
for(let i=0;i<8192;i++)if(P2[i]){S0[i]&=~P2[i];S1[i]&=~P2[i];
  for(let k=0;k<8;k++)if((P2[i]>>k)&1)hl++;}
console.log("пикселей подсветки (p2) на карте: "+hl);
// --- габарит подсветки для крупного плана ---
let xmin=1e9,xmax=-1,ymin=1e9,ymax=-1;
for(let col=0;col<32;col++)for(let lo=0;lo<256;lo++){
  const v=P2[col*256+lo]; if(!v)continue;
  const r=(31-lo)&255;
  for(let k=7;k>=0;k--)if((v>>k)&1){const x=col*8+(7-k);
    if(x<xmin)xmin=x; if(x>xmax)xmax=x; if(r<ymin)ymin=r; if(r>ymax)ymax=r;}
}
console.log(`габарит подсветки: x ${xmin}..${xmax}, экранные строки ${ymin}..${ymax}`);
// --- сборка контактного листа ---
const rows=[];
function pushCrop(bmp,x0,y0,x1,y1,sc){
  for(let y=y0;y<y1;y++){const line=[];
    for(let x=x0;x<x1;x++){const c=bmp[y*W+x]>>>0;
      for(let s=0;s<sc;s++)line.push(c&255,(c>>8)&255,(c>>16)&255);}
    const buf=Buffer.from(line); for(let s=0;s<sc;s++)rows.push(buf);}
}
function sep(w,n){const l=Buffer.alloc(w*3,0x20);for(let i=0;i<n;i++)rows.push(l);}
// крупный план: габарит подсветки + поля
const cx0=Math.max(0,(xmin-6)*2+32), cx1=Math.min(W,(xmax+7)*2+32);
const cy0=Math.max(0,ymin+16-6), cy1=Math.min(H,ymax+16+7);
const ZW=(cx1-cx0)*3;
for(const [tag,q0,q1] of [["ПРОЗРАЧНАЯ (как сейчас)",P0,P1],["СПЛОШНАЯ (после замещения)",S0,S1]]){
  for(const ph of PH){
    const p=pal.slice();
    if(tag[0]==="С"){p[2]=p[3]=toRGB(ph);}          // сплошная: мерцает ОДИН слот idx2
    else {for(const s of [2,3,6,7,10,11,14,15])p[s]=toRGB(ph);}  // как сейчас: четыре пары
    pushCrop(render(q0,q1,P2,p),cx0,cy0,cx1,cy1,3);
    sep(ZW,4);
  }
  sep(ZW,10);
}
// ЧИСЛЕННАЯ СВЕРКА: сколько пикселей кадра РЕАЛЬНО отличаются между версиями в каждой фазе
for(const ph of PH){
  const pa=pal.slice(); for(const s of [2,3,6,7,10,11,14,15])pa[s]=toRGB(ph);
  const pb=pal.slice(); pb[2]=pb[3]=toRGB(ph);
  const A=render(P0,P1,P2,pa), B=render(S0,S1,P2,pb);
  let d=0; for(let i=0;i<A.length;i++)if(A[i]!==B[i])d++;
  console.log(`фаза 0x${ph.toString(16).padStart(3,"0")}: прозрачная против сплошной — различий ${d} пикс`);
}
const HGT=rows.length;
const zip=require("zlib");
const raw=Buffer.concat(rows.map(r=>Buffer.concat([Buffer.alloc(1),r])));
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);
  const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);
  c.writeUInt32BE(require("zlib").crc32?0:0);return Buffer.concat([l,tt,c]);}
// CRC32 своими руками (в старых node zlib.crc32 нет)
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;
  for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(bf){let c=0xffffffff;for(let i=0;i<bf.length;i++)c=crcT[(c^bf[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function ck(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);
  const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt));
  return Buffer.concat([l,tt,c]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(ZW,0);ihdr.writeUInt32BE(HGT,4);ihdr[8]=8;ihdr[9]=2;
require("fs").writeFileSync(OUT,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  ck("IHDR",ihdr),ck("IDAT",zip.deflateSync(raw)),ck("IEND",Buffer.alloc(0))]));
console.log("крупный план: "+OUT+`  (${ZW}x${HGT})`);
// общий вид карты в средней фазе, обе версии
{const p=pal.slice();for(const s of [2,3,6,7,10,11,14,15])p[s]=toRGB(PH[2]);
 pngFrom(render(P0,P1,P2,p),OUT.replace(/\.png$/,"_общий_прозрачная.png"));
 const q=pal.slice();q[2]=q[3]=toRGB(PH[2]);
 pngFrom(render(S0,S1,P2,q),OUT.replace(/\.png$/,"_общий_сплошная.png"));
 console.log("общий вид: "+OUT.replace(/\.png$/,"_общий_*.png"));}
