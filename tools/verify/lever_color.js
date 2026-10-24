// lever_color.js — ЦВЕТ РЫЧАГА ВОРОТ: какие слоты палитры он занимает и что в нём мигает.
//
// ЖАЛОБА ВЛАДЕЛЬЦА: «рычаг меняет цвет». ТРЕБОВАНИЕ: обвод — стабильный красный, внутри —
// МИГАЮЩАЯ сердцевина, и мигание палитровое (как аура сокровищ), а не перерисовкой.
//
// КАК МЕРЯЕТ. Ловит кадр, в котором блиттер рисует тайл рычага (0x5C «вниз», 0x5D «вверх»,
// 0x5E подставка), запоминает клетку и дальше кадр за кадром снимает 8x8 индексов палитры
// этой клетки. Отчёт: (1) сколько РАЗНЫХ индексов у тайла и сколько пикселей в каждом;
// (2) сколько ПИКСЕЛЕЙ меняет индекс между соседними кадрами — обвод обязан быть нулём;
// (3) какие слоты палитры меняют ЦВЕТ (это и есть мигание — оно должно быть ровно у слота
// сердцевины). Первое и третье вместе доказывают «мигает палитра, а не пиксели».
//
// Запуск: node tools/verify/lever_color.js [rom] [sym] [кадров]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const pos=process.argv.slice(2).filter(a=>/\.(rom|sym)$/.test(a));
const ROM=pos[0]||T+"/../../build/kvalley_8c.rom";
const SYM=pos[1]||ROM.replace(/\.rom$/,".sym");
const NF=+(process.argv.find(a=>/^\d+$/.test(a))||3000);
// какой тайл рычага наблюдать: 5C «вниз» (мигающий), 5D «вверх», 5E подставка
const ti=process.argv.indexOf("--tile"), WANT=ti>0?parseInt(process.argv[ti+1],16):0x5C;
const E=make(ROM,SYM);
const {L,rd,v06c,run,cpu,io}=E;
const idxAt=(col,lo,b)=>{const a=0x8000+((col&31)<<8)+(lo&255);
  return ((rd(a)>>b)&1)<<3|((rd(a+0x2000)>>b)&1)<<2|((rd(a+0x4000)>>b)&1)<<1;};
let seen=null, tile=0;
v06c.check_breakpoint=function(){
  // ЛОВУШКА: vbt8_dhit — точка «диспетчер нашёл запись для этого тайла» (2026-08-04
  // цепочка `sub/cp/jp` заменена таблицей диапазонов, метки vbt8_chk_lever больше нет).
  // Срабатывает на любом спец-тайле, нужный отбираем по vw_byte, как и раньше;
  // C = столбец и vbt8_e здесь уже посчитаны.
  if(cpu.pc===L.vbt8_dhit){const t=rd(L.vw_byte);
    if(t===WANT){seen={col:cpu.reg(1),e:rd(L.vbt8_e),t};}}
  return false;
};
run(400);
let cell=null, cellT=0;
const snap=()=>{const a=[];for(let r=0;r<8;r++)for(let b=7;b>=0;b--)a.push(idxAt(cell.col,(cell.e-r)&255,b));return a;};
const hist=new Map(); let prev=null, chPix=0, chFrames=0, frames=0;
const palHist=new Map(), used=new Set();
for(let f=0;f<NF;f++){
  seen=null;
  v06c.oneInterrupt(true);
  if(seen&&(!cell||seen.t!==cellT)){cell={col:seen.col,e:seen.e};cellT=seen.t;prev=null;}
  if(!cell) continue;
  if(seen&&seen.t!==cellT) continue;
  const s=snap(); frames++;
  for(const v of s) hist.set(v,(hist.get(v)||0)+1);
  if(prev){let d=0;for(let i=0;i<64;i++)if(prev[i]!==s[i])d++;if(d){chPix+=d;chFrames++;}}
  prev=s;
  for(const v of new Set(s)) used.add(v);
  if(frames>400) break;
}
if(!cell){console.log("тайлы рычага (0x5C-0x5E) не встретились");process.exit(1);}
console.log(`ROM: ${ROM}`);
console.log(`клетка рычага: столбец ${cell.col}, верх lo=${cell.e}, последний тайл 0x${cellT.toString(16)}`);
console.log(`кадров под наблюдением: ${frames}`);
console.log(`ИНДЕКСЫ ПИКСЕЛЕЙ ТАЙЛА: `+[...hist.entries()].sort((a,b)=>b[1]-a[1])
  .map(([k,v])=>`idx${k}:${(v/frames).toFixed(1)}пикс`).join("  "));
console.log(`ПЕРЕРИСОВКА (пикселей сменило индекс между соседними кадрами): ${chPix} на ${chFrames} кадрах`);
// МИГАНИЕ — палитровое, и живёт оно только в геймплее (вне GameStatus=5 vbp держит idx4
// статичным). Поэтому цвета слотов, которыми нарисован рычаг, снимаются отдельным
// прогоном по кадрам геймплея.
for(let i=0;i<6000&&rd(L.GameStatus)!==5;i++) v06c.oneInterrupt(true);
for(let i=0;i<64;i++){ v06c.oneInterrupt(true);
  const pal=v06c.filler?v06c.filler.palette:io.Palette;
  for(const v of used){const k="idx"+v;if(!palHist.has(k))palHist.set(k,new Set());
    palHist.get(k).add((pal[v]>>>0).toString(16));} }
console.log("ЦВЕТА ЭТИХ СЛОТОВ ЗА 64 КАДРА ГЕЙМПЛЕЯ:");
for(const [k,v] of palHist) console.log(`   ${k}: ${v.size} цвет(ов) (${[...v].join(",")})`
  +(v.size>1?"  <- МИГАЕТ ПАЛИТРОЙ":"  стабилен"));
