// ТАБЛИЦА ЦВЕТОВ: что реально стоит в 16 регистрах палитры и сколько пикселей этим красится.
//
// ЗАЧЕМ. Подбор цветов идёт глазами по экрану, а спорить надо о числах: какой байт стоит в
// слоте, какой это RGB, и сколько пикселей поля он красит. Плюс палитра МЕНЯЕТСЯ ПО УРОВНЯМ
// (схема камня kv_stone_scheme = ((piramideActual-1)>>2)&3), поэтому снимаем несколько
// пирамид, а не одну — иначе половина раскладки останется невидимой.
//
// ФОРМАТ ЦВЕТА ВЕКТОРА-06Ц (io.js:291): байт = BBGGGRRR.
//   B = биты 7-6 (2 бита, 4 градации!)   G = биты 5-3 (3 бита)   R = биты 2-0 (3 бита)
//   RGB: r = R<<5, g = G<<5, b = B<<6 — то есть 8 уровней красного и зелёного и ТОЛЬКО
//   ЧЕТЫРЕ уровня синего. Всего 256 цветов, но синева грубая — это главное ограничение
//   при подборе: голубой и синий развести труднее, чем оттенки жёлтого.
//
// Запуск: node tools/verify/palette_table.js [rom] [sym] [пирамиды через запятую]
// По умолчанию 1,5,9,13 — по одной на каждую схему камня.
"use strict";
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const PYRS=(process.argv[4]||"1,5,9,13").split(",").map(x=>+x).filter(x=>x>=1&&x<=15);
const {L,rd,run,key,memory,v06c,io}=E;

const rgbOf=w8=>{const b=(w8&0xc0)>>6, g=(w8&0x38)>>3, r=(w8&0x07);
  return [r<<5, g<<5, b<<6];};
const hex=a=>"#"+a.map(x=>x.toString(16).padStart(2,"0")).join("");
// Обратный разбор: сколько «ступеней» каждого канала занято — по нему видно запас на подкрутку.
const steps=w8=>`R${w8&7}/8 G${(w8&0x38)>>3}/8 B${(w8&0xc0)>>6}/4`;

// Гистограмма индексов ПО ИГРОВОМУ ПОЛЮ (lo 0x40-0xFF). Кайма (табло) считается отдельно:
// мешать их — значит прятать расхождения одной зоны за другой.
function hist(){
  const f=new Array(16).fill(0), b=new Array(16).fill(0), bytes=memory.bytes;
  for(let lo=0;lo<256;lo++){ const t=(lo>=0x40)?f:b;
    for(let col=0;col<32;col++){ const a=0x8000+col*256+lo;
      const p0=bytes[memory.tobank(a)],p1=bytes[memory.tobank(a+0x2000)],
            p2=bytes[memory.tobank(a+0x4000)],p3=bytes[memory.tobank(a+0x6000)];
      for(let k=7;k>=0;k--) t[((p0>>k)&1)<<3|((p1>>k)&1)<<2|((p2>>k)&1)<<1|((p3>>k)&1)]++; }}
  return {field:f, border:b};
}
// Байт палитры, как его записала игра: io.Palette хранит уже развёрнутый RGB, поэтому
// сворачиваем обратно — так в таблице виден ИСХОДНЫЙ байт, которым и придётся править.
function rawByte(i){
  const c=(v06c.filler?v06c.filler.palette:io.Palette)[i]>>>0;
  const r=(c&255)>>5, g=((c>>8)&255)>>5, b=((c>>16)&255)>>6;
  return (b<<6)|(g<<3)|r;
}

const gs=toGame(E);
if(gs!==5){ console.log("ПРОВАЛ: до геймплея не дошли, GameStatus="+gs); process.exit(2); }
// Читов может не быть вовсе (в линии c188f2b блок снят) — это не провал, см. hopTo ниже.
const CHEATS = L.vec_cheats!==undefined&&!!rd(L.vec_cheats);
if(CHEATS){ key(71,1); run(3); key(71,0); run(5); }   // бессмертие: иначе мумии убьют между снимками

// ПЕРЕХОД НА ПИРАМИДУ — ДВУМЯ СПОСОБАМИ, потому что сборки разные.
// В линии slots-in-ram живы отладочные читы (замок F1+F5), и переход делает чит N: он идёт
// штатным путём игры (vec_hop выставляет piramideDest, puertaSalida и puertaEntrada из
// таблицы vec_hop_ent). В линии c188f2b блок читов СНЯТ (см. «[СНЯТО 2026-08-20] ЗДЕСЬ БЫЛ
// БЛОК ОТЛАДОЧНЫХ ЧИТОВ» в vec_isr.asm) — там остаётся прямая запись переменных, и ей надо
// отдать не только номер пирамиды, но и дверь входа, иначе уровень не загрузится.
function hopTo(target){
  let guard=0;
  while(rd(L.piramideActual)!==target && guard++<24){
    const cur=rd(L.piramideActual);
    if(CHEATS){
      if(cur>target) return false;                    // чит ходит только вперёд
      key(78,1); run(3); key(78,0);
    } else {
      const nxt = (cur>target) ? target : cur+1;
      if(L.vec_hop_ent!==undefined) memory.write(L.puertaEntrada, rd(L.vec_hop_ent-1+nxt), false);
      memory.write(L.piramideDest, nxt, false);
      memory.write(L.subStatus, 0, false);
      memory.write(L.GameStatus, 8, false);
    }
    // ЖДЁМ ДОЛГО И ЖМЁМ ПРОБЕЛ. Переход идёт через карту долины со скроллом, а в линии без
    // читов он к тому же ждёт подтверждения. 2500 кадров не хватало: hopTo возвращал «не
    // сработал», а пирамида менялась ПОСЛЕ — следующий снимок оказывался не с того уровня,
    // и в отчёте это выглядело как «просили 9, получили 5».
    for(let f=0;f<9000 && !(rd(L.GameStatus)===5 && rd(L.piramideActual)!==cur);f++){
      if((f%600)===120){ key(32,1); run(2); key(32,0); }
      v06c.oneInterrupt(true);
    }
    if(rd(L.piramideActual)===cur){ console.error(`переход с пирамиды ${cur} не сработал`); return false; }
  }
  return rd(L.piramideActual)===target;
}

const PLANES=i=>`${(i>>3)&1}${(i>>2)&1}${(i>>1)&1}${i&1}`;
let shots=0;
for(const target of PYRS){
  hopTo(target);
  run(90);
  const got=rd(L.piramideActual);
  if(got!==target){ console.error(`ПРОПУСК: просили пирамиду ${target}, получили ${got}`); continue; }
  const h=hist(); shots++;
  console.log(`\n=== ПИРАМИДА ${got}   (схема камня ${((got-1)>>2)&3})`);
  console.log("idx | p0p1p2p3 | байт | ступени         |    RGB    | пикселей поля | каймы");
  for(let i=0;i<16;i++){
    const w8=rawByte(i), rgb=rgbOf(w8);
    console.log(` ${String(i).padStart(2)} |   ${PLANES(i)}   | 0x${w8.toString(16).toUpperCase().padStart(2,"0")} | ${steps(w8).padEnd(15)} | ${hex(rgb)} | ${String(h.field[i]).padStart(13)} | ${String(h.border[i]).padStart(5)}`);
  }
  const used=[...Array(16).keys()].filter(i=>h.field[i]);
  const uniq=new Set(used.map(i=>rawByte(i)));
  console.log(`  занято индексов в поле: ${used.length}/16, различных байтов среди них: ${uniq.size}`);
}
if(!shots){ console.log("\nПРОВАЛ ПОКРЫТИЯ: ни одной пирамиды не снято"); process.exit(1); }
console.log(`\nснято пирамид: ${shots} из ${PYRS.length}`);
