// msx_item_ref.js — ЭТАЛОН ОРИГИНАЛА: зум тайлов ножа и кирки прямо из VRAM картриджа.
//
// Байты сняты с ЖИВОГО картриджа legacy/msx/kvalley_z80.rom (headless-WebMSX через MCP
// msx-emu, геймплей): цвет — VRAM 0x0000+tile*8 (color table, все три банка идентичны,
// сверено на 0x0200/0x0A00/0x1200), паттерн — VRAM 0x2000+tile*8.
// Дополнительно сверено с дампом рантайма нашего ПЗУ (build/colortables/*.msxcolor.bin):
// у тайлов 0x45-0x4C цветовые строки ОДИНАКОВЫ на всех 15 пирамидах.
//
// Запуск: node tools/gfx/msx_item_ref.js <каталог PNG>
"use strict";
const fs = require("fs"), zlib = require("zlib");
const OUT = process.argv[2] || "/tmp";

// tile -> [паттерн(8), цвет(8)]. Цвет MSX: старший ниббл = fg, младший = bg (0 = прозрачный).
const T = {
  0x45: [[0xc0,0xe0,0x74,0x38,0x1c,0x28,0x00,0x00], [0xf0,0xf0,0xf0,0xa0,0xa0,0xa0,0xa0,0xa0]],
  0x46: [[0x00,0x00,0x00,0x00,0x05,0x03,0x07,0x02], [0xf0,0xf0,0xf0,0xf0,0xf0,0xa0,0xa0,0xa0]],
  0x47: [[0x00,0x00,0x60,0xe0,0xc0,0x80,0x00,0x80], [0xf0,0xf0,0xf0,0xf0,0xf0,0xf0,0xf0,0xa0]],
  0x48: [[0x50,0xe0,0x70,0xb8,0x1c,0x0c,0x00,0x00], [0xa0,0xa0,0xa0,0xf0,0xf0,0xf0,0xf0,0xf0]],
  0x49: [[0x00,0x00,0x01,0x00,0x01,0x03,0x07,0x06], [0xa0,0xa0,0xa0,0xa0,0xa0,0xf0,0xf0,0xf0]],
  0x4A: [[0x00,0x00,0x40,0xe0,0xc0,0xa0,0x00,0x00], [0xa0,0xa0,0xa0,0xa0,0xa0,0xf0,0xf0,0xf0]],
  0x4B: [[0x00,0x24,0x18,0x18,0x7e,0x18,0x18,0x18], [0xa0,0xa0,0xa0,0xa0,0xa0,0xf0,0xf0,0xf0]],
  0x4C: [[0x20,0x18,0x0c,0x0c,0x1a,0x33,0x61,0xc0], [0x90,0x90,0x90,0x90,0x60,0x60,0x60,0x60]],
};
// Палитра TMS9918 (та же, что у WebMSX).
const MSX = [[0,0,0],[0,0,0],[33,200,66],[94,220,120],[84,85,237],[125,118,252],[212,82,77],
  [66,235,245],[252,85,84],[255,121,120],[212,193,84],[230,206,128],[33,176,59],[201,91,186],
  [204,204,204],[255,255,255]];
const NAME = {0:"прозр",1:"чёрн",2:"ср.зелён",3:"св.зелён",4:"т.синий",5:"св.синий",6:"Т.КРАСНЫЙ",
  7:"циан",8:"ср.красн",9:"СВ.КРАСНЫЙ",0xa:"Т.ЖЁЛТЫЙ",0xb:"св.жёлт",0xc:"т.зелён",0xd:"пурпур",
  0xe:"серый",0xf:"БЕЛЫЙ"};

const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
function writePNG(file,W,H,px){const raw=Buffer.alloc(H*(W*3+1));
  for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;for(let x=0;x<W;x++){const c=px(x,y);const o=y*(W*3+1)+1+x*3;raw[o]=c[0];raw[o+1]=c[1];raw[o+2]=c[2];}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));}

function pix(tile,x,y){const [p,c]=T[tile];const on=(p[y]>>(7-x))&1;const ci=on?(c[y]>>4)&15:c[y]&15;
  return ci===0?[40,40,40]:MSX[ci];}

fs.mkdirSync(OUT,{recursive:true});
const Z=12,GAP=6;
function sheet(name,tiles){
  const W=tiles.length*(8*Z+GAP)+GAP,H=8*Z+GAP*2;
  writePNG(`${OUT}/${name}.png`,W,H,(x,y)=>{
    const cw=8*Z+GAP,i=Math.floor((x-GAP)/cw);
    if(i<0||i>=tiles.length)return[40,40,40];
    const lx=x-GAP-i*cw,ly=y-GAP;
    if(lx<0||lx>=8*Z||ly<0||ly>=8*Z)return[40,40,40];
    return pix(tiles[i],(lx/Z)|0,(ly/Z)|0);});
  console.log(`PNG: ${OUT}/${name}.png  тайлы ${tiles.map(t=>"0x"+t.toString(16)).join(" ")}`);
}
sheet("msx_knife_floor",[0x4B]);
sheet("msx_pick",[0x4C]);
sheet("msx_knife_fly",[0x45,0x46,0x47,0x48,0x49,0x4A]);

console.log("\n=== ЦВЕТ ПО СТРОКАМ (оригинал MSX) ===");
for(const t of Object.keys(T).map(Number).sort((a,b)=>a-b)){
  const c=T[t][1];
  const seg=[];let s=0;
  for(let i=1;i<=8;i++) if(i===8||((c[i]>>4)&15)!==((c[s]>>4)&15)){seg.push(`строки ${s}-${i-1}: ${NAME[(c[s]>>4)&15]}`);s=i;}
  console.log(` тайл 0x${t.toString(16)}: `+seg.join("  |  "));
}
