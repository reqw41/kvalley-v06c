// Гистограмма индексов палитры на игровом экране: ОТДЕЛЬНО поле (lo 0x40-0xFF) и кайма
// (lo 0x00-0x3F). Нужна была при сравнении схем 3 плоскости / A+ 2+2: показывает не «сколько
// цветов заявлено», а сколько РАЗЛИЧНЫХ ЗНАЧЕНИЙ реально стоит в 16 регистрах и сколько
// пикселей каймы видно на экране. В трёхплоскостной схеме палитра схлопнута по биту p3
// (color[2k]==color[2k+1]) — этим и прятались 8 КБ данных, лежавших в p3.
// Гистограмма индексов палитры ОТДЕЛЬНО по полю (lo 0x40-0xFF) и кайме (lo 0x00-0x3F).
// Кайма — это область фреймбуфера, где живут данные. Видна она или нет, решает палитра.
"use strict";
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
const {rd,L,run,key,memory,v06c,io}=E;
const gs=toGame(E);
key(71,1); run(3); key(71,0); run(+(process.argv[4]||200));
if(gs!==5){ console.log("ПРОВАЛ: не дошли до геймплея, GameStatus="+gs); process.exit(2); }
const pal=v06c.filler?v06c.filler.palette:io.Palette;
const bytes=memory.bytes;
const H={field:new Array(16).fill(0), border:new Array(16).fill(0)};
for(let lo=0;lo<256;lo++){
  const where=(lo>=0x40)?"field":"border";
  for(let col=0;col<32;col++){
    const a=0x8000+col*256+lo;
    const p0=bytes[memory.tobank(a)],p1=bytes[memory.tobank(a+0x2000)],
          p2=bytes[memory.tobank(a+0x4000)],p3=bytes[memory.tobank(a+0x6000)];
    for(let b=7;b>=0;b--) H[where][((p0>>b)&1)<<3|((p1>>b)&1)<<2|((p2>>b)&1)<<1|((p3>>b)&1)]++;
  }
}
const hex=c=>{const v=c>>>0;return "#"+[(v&255),(v>>8)&255,(v>>16)&255].map(x=>x.toString(16).padStart(2,"0")).join("");};
console.log("idx | биты | цвет    |     ПОЛЕ |    КАЙМА");
for(let i=0;i<16;i++){
  const bits=[(i>>3)&1,(i>>2)&1,(i>>1)&1,i&1].join("");
  console.log(` ${String(i).padStart(2)} | ${bits} | ${hex(pal[i])} | ${String(H.field[i]).padStart(8)} | ${String(H.border[i]).padStart(8)}`);
}
// СКОЛЬКО ПИКСЕЛЕЙ КАЙМЫ БЫЛИ БЫ ВИДНЫ, будь палитра невырожденной:
// не видны только те, чей цвет совпадает с цветом idx0 (фон-чёрный).
let hidden=0, visible=0;
for(let i=0;i<16;i++){ if(pal[i]===pal[0]) hidden+=H.border[i]; else visible+=H.border[i]; }
const nz=H.border.reduce((a,b,i)=>a+(i?b:0),0);
console.log(`\nКАЙМА: ненулевых пикселей (idx!=0) ${nz}`);
console.log(`  СЕЙЧАС видно на экране (цвет != цвета idx0): ${visible}`);
console.log(`  спрятано схлопыванием палитры (цвет == цвет idx0): ${hidden-H.border[0]}`);
const uniqF=new Set(), uniqAll=new Set();
for(let i=0;i<16;i++){ if(H.field[i]) uniqF.add(hex(pal[i])); uniqAll.add(hex(pal[i])); }
console.log(`РАЗЛИЧНЫХ ЦВЕТОВ в поле: ${uniqF.size}; различных значений в 16 регистрах палитры: ${uniqAll.size}`);
