// spr_cols.js — ЗАДАЧА #44: ГЕОМЕТРИЯ ВЫВОДА В БЛОКАХ (столбец x плоскость).
//
// ЗАЧЕМ. Цена спрайта во фреймбуфере пропорциональна не «ширине фигуры», а числу БЛОКОВ
// «столбец x плоскость»: столько байт стирается, столько сохраняется и столько выводится
// (16 строк на блок). Габарит всегда начинается со столбца X>>3 и умеет отбросить лишь
// пустой ПРАВЫЙ столбец — значит силуэт, стоящий в СЕРЕДИНЕ 16-пиксельной клетки, седлает
// два байтовых столбца почти при любом X. Эта метрика показывает распределение по столбцам
// и суммарные блоки в разрезе категорий объектов — ровно то, что двигает правка.
//
// Считает на КАЖДОЙ пачке (vec_spr_out) по ЗАПИСИ ВЫВОДА каждого объекта:
//   ncols = слот+0x99, плоскостей = 1 + (слот+0x9F != 0) + (слот+0x9B != 0),
//   блоков = ncols * плоскостей.   Пропускаются pending!=1 (скрытые/дедуплённые).
// Плюс: сколько пачек ушло СЛИТОЙ ЗАПИСЬЮ (vsp_fast) — правка габарита может выбить
// объект со слитого пути, и это надо видеть рядом с выигрышем.
// Разрез по слотам тот же, что в mummy_survey.js: 0-3 ворота, 4-5 герой, 6-13 враги
// (мумии и прочие твари), 15-18 нож, 19-20 карта.
//
// Запуск: node tools/verify/spr_cols.js [rom] [sym] [кадров на пирамиду] [пирамид]
//         node tools/verify/spr_cols.js <rom> <sym> --ticks 2600   (сцена по ТИКАМ — для A/B)
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const PF=+(process.argv[4]||900), NP=+(process.argv[5]||8);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c}=E;
const cat=i=>i<4?"ворота":i<6?"герой":i<14?"враги":i<19?"нож":"карта";
const cats=["ворота","герой","враги","нож","карта"];
// у врагов отдельно СОБСТВЕННО МУМИИ — по паттерну (только они читают vec_spr_momia)
const isMomia=p=>(p>=0x28&&p<0x34)||(p>=0x88&&p<0x94);
const colH={}, blocks={}, outs={};
for(const c of cats.concat(["мумии"])){colH[c]=new Array(4).fill(0);blocks[c]=0;outs[c]=0;}
let packs=0, fastPacks=0, live=false, frames=0;

v06c.check_breakpoint=function(){
  if(E.cpu.pc!==L.vec_spr_out||!live)return false;
  packs++; if(rd(L.vsp_fast))fastPacks++;
  const n=rd(L.vsp_n);
  for(let k=0;k<n;k++){
    const idx=rd(L.vsp_list+k), pg=0xE000+idx*256;
    if(rd(pg+0x96)!==1)continue;
    const nc=rd(pg+0x99); if(!nc)continue;
    const np=1+(rd(pg+0x9F)?1:0)+(rd(pg+0x9B)?1:0);
    const c=cat(idx), pat=rd(L.sprAttrib+idx*4+2);
    colH[c][Math.min(3,nc)]++; blocks[c]+=nc*np; outs[c]++;
    if(c==="враги"&&isMomia(pat)){colH["мумии"][Math.min(3,nc)]++;blocks["мумии"]+=nc*np;outs["мумии"]++;}
  }
  return false;
};
// --- ДРАЙВЕР СЦЕНЫ ---------------------------------------------------------------
// По умолчанию — псевдослучайный ввод ПО КАДРАМ (историческая сцена этого инструмента).
// С флагом --ticks N ввод подаётся ПО ИГРОВЫМ ТИКАМ по расписанию coltab_frame_parity:
// тогда две сборки с РАЗНОЙ скоростью играют ОДНУ И ТУ ЖЕ партию, и их метрики
// сравнимы. Без этого более быстрая сборка успевает уйти в другую комнату, и разница
// в цифрах — это разница сцен, а не правки.
const TI=process.argv.indexOf("--ticks"), NT=TI>0?+(process.argv[TI+1]||2600):0;
function keysForTick(t){
  const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000)k.push(39);
  else if(t<1010)k.push(78);
  else if(t<1300)k.push((t&8)?39:37);
  else if(t<1310)k.push(78);
  else if(t<1600)k.push((t&8)?38:39);
  else if(t<1640)k.push(78);
  else if(t<2000)k.push((t&8)?39:37);
  else if(t<2060)k.push(78);
  else k.push((t&8)?37:39);
  return k;
}
let seed=2024;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const KS=[37,39,38,40];let held=-1;
function step(){v06c.oneInterrupt(true);live=(rd(L.GameStatus)===5);if(live)frames++;}
if(NT){
  let tick=0,prevT=rd(L.timer),heldSet=new Set(),guard=0;
  while(tick<=NT&&guard++<400000){
    const want=new Set(keysForTick(tick));
    for(const c of heldSet)if(!want.has(c))E.key(c,0);
    for(const c of want)if(!heldSet.has(c))E.key(c,1);
    heldSet=want;
    step();
    const t=rd(L.timer); if(t!==prevT){prevT=t;tick++;}
  }
}else
for(let p=0;p<NP;p++){
  if(p>0){live=false;E.key(78,1);step();E.key(78,0);
    for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++)step();
    for(let i=0;i<40;i++)step();}
  for(let f=0;f<PF;f++){
    if(f%17===0){const k=KS[(rnd()*4)|0];if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
    step();
    if(rd(L.GameStatus)!==5)for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++)step();
  }
  if(held>0){E.key(held,0);held=-1;}
}
console.log(`ROM=${ROM.replace(/.*\//,"")}  кадров геймплея ${frames}, пачек ${packs}, из них СЛИТЫХ ${fastPacks}`);
console.log("\nкатегория   выводов   столбцов 1 /  2  /  3    БЛОКОВ (столбец x плоскость)");
let tot=0;
for(const c of cats.concat(["мумии"])){
  if(!outs[c])continue;
  const h=colH[c];
  if(c!=="мумии")tot+=blocks[c];
  console.log(`${c.padEnd(10)} ${String(outs[c]).padStart(7)}   ${String(h[1]).padStart(6)} ${String(h[2]).padStart(6)} ${String(h[3]).padStart(6)}    ${String(blocks[c]).padStart(7)}${c==="мумии"?"   (подмножество «врагов»)":""}`);
}
console.log(`${"ВСЕГО".padEnd(10)} ${"".padStart(7)}   ${"".padStart(6)} ${"".padStart(6)} ${"".padStart(6)}    ${String(tot).padStart(7)}`);
