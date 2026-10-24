// palette_variants.js — ПОДБОР ТЁМНЫХ ВАРИАНТОВ ДЛЯ СЛОТОВ ПАЛИТРЫ (idx14 зелёный,
// idx2 серый) С ЗАМЕРОМ РАССТОЯНИЙ ДО ВСЕХ СОСЕДЕЙ НА ЧЕТЫРЁХ СХЕМАХ КАМНЯ.
//
// ЗАЧЕМ. Владелец просит «зелёный ворот потемнее» и «серый тоже потемнее». Свободных
// слотов в палитре нет, поэтому потемнение задевает ВСЕХ жителей слота сразу (см.
// slot_ledger.js). Решение вкусовое, но у него есть жёсткая граница: пара цветов не должна
// сойтись ближе ПОРОГА РАЗЛИЧИМОСТИ. Порог взят из самого проекта — 51 RGB: столько между
// idx12 (белый) и idx2 (серый), которые давно приняты как различимые («одежда героя на
// белой лестнице»).
//
// ФОРМАТ БАЙТА ВЕКТОРА: %BBGGGRRR — синий 2 бита, зелёный и красный по 3.
// Разложение в 8 бит: 3-битное поле * 255/7, 2-битное * 255/3.
//
// ЧТО СЧИТАЕТ для каждого варианта:
//   * RGB-расстояние до КАЖДОГО занятого слота на всех четырёх схемах камня — и отдельно
//     до idx0 (чёрный коридор) и до idx12 (белый пол/лестница/шрифт);
//   * помечает КРАСНЫМ всё, что уходит ниже порога.
//
// Запуск: node tools/verify/palette_variants.js [rom] [sym]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const pos=process.argv.slice(2).filter(a=>/\.(rom|sym)$/.test(a));
const ROM=pos[0]||T+"/../../build/kvalley_8c.rom";
const SYM=pos[1]||ROM.replace(/\.rom$/,".sym");
const THR=51;

const b3=v=>Math.round(v*255/7), b2=v=>Math.round(v*255/3);
const toRGB=b=>[b3(b&7), b3((b>>3)&7), b2((b>>6)&3)];
const hex=b=>{const [r,g,bl]=toRGB(b);return "#"+[r,g,bl].map(x=>x.toString(16).padStart(2,"0")).join("");};
const dist=(x,y)=>{const a=toRGB(x),b=toRGB(y);
  return Math.round(Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2));};

// --- живая палитра каждой схемы камня: снимаем прямо из игры ---
const E=make(ROM,SYM);
const {L,rd,v06c,run,key,io}=E;
run(700);
for(let i=0;i<30;i++){key(32,1);run(3);key(32,0);run(3);}
for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++) v06c.oneInterrupt(true);
// байты схем камня лежат таблицей в образе — читаем их, чтобы не гонять 15 пирамид
const stoneA=[], stoneB=[];
for(let i=0;i<4;i++){stoneA.push(rd(L.kv_stone_scheme+i)); stoneB.push(rd(L.kv_stone_scheme+4+i));}
const pal=v06c.filler?v06c.filler.palette:io.Palette;
// текущие байты слотов восстанавливаем из живой палитры (u32 = 0xAABBGGRR)
// Обратное преобразование ровно то же, что в slot_ledger.js: эмулятор растягивает
// 3-битное поле как v*32, 2-битное как v*64, поэтому байт восстанавливается сдвигами.
const byteOf=a=>(((a>>>22)&3)<<6)|(((a>>>13)&7)<<3)|((a>>>5)&7);
const cur={};
for(const i of [0,2,4,6,8,10,12,14]) cur[i]=byteOf(pal[i]>>>0);

console.log(`ROM: ${ROM}`);
console.log(`ПОРОГ РАЗЛИЧИМОСТИ: ${THR} RGB (расстояние idx12/idx2 в текущей палитре)\n`);
console.log("ТЕКУЩИЕ СЛОТЫ (пирамида 1):");
for(const i of [0,2,4,6,8,10,12,14])
  console.log(`  idx${String(i).padStart(2)}  байт 0x${cur[i].toString(16).toUpperCase().padStart(2,"0")}  ${hex(cur[i])}`);
console.log(`\nТОНЫ КАМНЯ ПО СХЕМАМ (idx8 / idx10):`);
for(let s=0;s<4;s++)
  console.log(`  схема ${s}: idx8 0x${stoneA[s].toString(16).toUpperCase()} ${hex(stoneA[s])}`
    +`   idx10 0x${stoneB[s].toString(16).toUpperCase()} ${hex(stoneB[s])}`);

// соседи, до которых меряем: постоянные слоты + оба тона камня всех схем
function neighbours(exclude){
  const out=[];
  for(const i of [0,2,4,6,10,12,14]) if(i!==exclude) out.push([`idx${i}`,cur[i]]);
  for(let s=0;s<4;s++){ out.push([`камень A сх${s}`,stoneA[s]]); out.push([`камень B сх${s}`,stoneB[s]]); }
  return out;
}
function table(name,slot,variants){
  console.log(`\n================ ${name} ================`);
  const nb=neighbours(slot);
  const head="вариант        цвет      "+nb.map(([n])=>n.padStart(13)).join("");
  console.log(head);
  for(const v of [cur[slot],...variants]){
    const mark=v===cur[slot]?"ТЕКУЩИЙ ":"        ";
    let line=(mark+"0x"+v.toString(16).toUpperCase().padStart(2,"0")).padEnd(15)+hex(v).padEnd(10);
    for(const [,c] of nb){const d=dist(v,c); line+=(d<THR?`!!${d}`:`${d}`).padStart(13);}
    console.log(line);
  }
  console.log("  !! = ниже порога различимости, вариант БРАКОВАН");
}

// ЗЕЛЁНЫЙ: понижаем поле G, красный и синий держим в нуле (чистый зелёный, как в MSX).
table("idx14 ЗЕЛЁНЫЙ (ворота, выходы, зелёное сокровище)", 14, [0x30,0x28,0x20,0x18]);
// СЕРЫЙ: держим лёгкий синий подтон текущего 0xF6 (B на ступень выше R/G) и опускаем R/G.
table("idx2 СЕРЫЙ (одежда героя, холодная мумия, нож, фон ступеней, серое сокровище)", 2,
      [0x0ED,0x0E4,0x0AD,0x0A4]);
