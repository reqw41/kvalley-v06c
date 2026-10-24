// УВЕЛИЧЕННЫЙ СНИМОК УЧАСТКА ЭКРАНА — чтобы смотреть цвет предметов глазами, а не по индексам.
//
// ЗАЧЕМ. Спор о раскраске идёт про объекты 8x8 пикселей: сокровище, рукоять ножа, головка
// кирки. На полном кадре 576x288 их не разглядеть, а таблица индексов не отвечает на вопрос
// «а красиво ли». Здесь кадр берётся из фреймбуфера (idealBmp, без разрывов луча), вырезается
// окно вокруг заданной клетки карты и увеличивается целыми пикселями.
//
// Запуск: node tools/verify/zoom_shot.js <rom> <sym> <out.png> [пирамида] [масштаб] [клеток]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const fs=require("fs"), zlib=require("zlib");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const OUT=process.argv[4]||"zoom.png";
const WANT=+(process.argv[5]||1), SCALE=+(process.argv[6]||6), CELLS=+(process.argv[7]||10);
const {L,rd,run,key,memory,v06c,idealBmp,W,H}=E;

const gs=toGame(E);
if(gs!==5){ console.log("ПРОВАЛ: до геймплея не дошли, GameStatus="+gs); process.exit(2); }
const CHEATS=L.vec_cheats!==undefined&&!!rd(L.vec_cheats);
if(CHEATS){ key(71,1); run(3); key(71,0); run(5); }
while(rd(L.piramideActual)<WANT){
  const cur=rd(L.piramideActual);
  if(CHEATS){ key(78,1); run(3); key(78,0); }
  else { const nxt=cur+1;
    if(L.vec_hop_ent!==undefined) memory.write(L.puertaEntrada, rd(L.vec_hop_ent-1+nxt), false);
    memory.write(L.piramideDest,nxt,false); memory.write(L.subStatus,0,false); memory.write(L.GameStatus,8,false); }
  let f=0; for(;f<9000 && !(rd(L.GameStatus)===5 && rd(L.piramideActual)!==cur);f++){
    if((f%600)===120){ key(32,1); run(2); key(32,0); }
    v06c.oneInterrupt(true); }
  if(rd(L.piramideActual)===cur) break;
}
run(150);

// Ищем в карте текущей комнаты первое сокровище — вокруг него и режем окно.
const rd16=a=>rd(a)|(rd(a+1)<<8);
const tileFromID=id=>{const grp=rd16(L.indexTiles+((id>>3)&0x1E)); return rd(grp+(id&0x0F));};
const room=rd(L.ProtaRoom);
let anchor=null, what="герой";
for(const t of [0x86,0x87,0x88,0x89,0x8A,0x8B,0x4B,0x4C]){
  for(let r=0;r<22 && !anchor;r++) for(let c=0;c<96;c++){
    const id=rd(L.MapaRAM+r*96+c);
    if(id && tileFromID(id)===t && (c>>5)===room){ anchor=[r,c%32]; what="тайл 0x"+t.toString(16).toUpperCase(); break; }
  }
  if(anchor) break;
}
// Запасной якорь — герой: если предметов в комнате нет, смотреть всё равно есть на что.
if(!anchor) anchor=[rd(L.ProtaY)>>3, rd(L.ProtaX)>>3];
const [ar,ac]=anchor;
console.log(`пирамида ${rd(L.piramideActual)}, комната ${room}, якорь ${what} — клетка r${ar} c${ac}`);

// Геометрия ровно как в idealBmp: экранная строка r -> строка картинки r+16, столбец col*8 -> +32,
// каждый пиксель кадра шириной 2 (Вектор растягивает по горизонтали).
const bmp=idealBmp();
// Поправка поля: над картой 48 растровых строк каймы с табло (замер по герою).
const MAP_Y0=48;
const cx=32+ac*8*2, cy=16+MAP_Y0+ar*8;
const half=CELLS*8;
let x0=Math.max(0,cx-half), y0=Math.max(0,cy-half/2);
let x1=Math.min(W,cx+half), y1=Math.min(H,cy+half/2);
const w=x1-x0, h=y1-y0, OW=w*SCALE, OH=h*SCALE;
const rgb=Buffer.alloc(OW*OH*3);
for(let y=0;y<OH;y++) for(let x=0;x<OW;x++){
  const c=bmp[(y0+((y/SCALE)|0))*W + (x0+((x/SCALE)|0))]>>>0, o=(y*OW+x)*3;
  rgb[o]=c&255; rgb[o+1]=(c>>8)&255; rgb[o+2]=(c>>16)&255;
}
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
const crc=b=>{let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);
  const tt=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(tt));
  return Buffer.concat([l,tt,cc]);};
const raw=Buffer.alloc(OH*(OW*3+1));
for(let y=0;y<OH;y++){ raw[y*(OW*3+1)]=0; rgb.copy(raw,y*(OW*3+1)+1,y*OW*3,(y+1)*OW*3); }
const ih=Buffer.alloc(13); ih.writeUInt32BE(OW,0); ih.writeUInt32BE(OH,4); ih[8]=8; ih[9]=2;
fs.writeFileSync(OUT,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk("IHDR",ih),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
console.log(`  окно ${w}x${h} -> ${OW}x${OH}, масштаб x${SCALE} -> ${OUT}`);
