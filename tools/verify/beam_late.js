// beam_late.js — успевает ли пачка вывода за лучом (задача #36, приёмка по фликеру).
// Модель луча та же, что в beam_anchor.js: луч над игровой строкой Y приходит на такте
// irq + 13780 + 192*Y (проверена побайтно, см. шапку vec_sprout.asm).
// Что считает, ТОЛЬКО на кадрах геймплея (GameStatus=5):
//   1) окно пачки vec_spr_out: такт старта и такт конца от прерывания (avg/p50/p90);
//   2) на КАЖДЫЙ выведенный объект — «ЗАКОНЧЕН ПОЗЖЕ ЛУЧА»: последний байт объекта лёг
//      в fb после того, как луч прошёл его ВЕРХНЮЮ строку Ytop=255-(lo0+15);
//   3) ТРАНЗИЕНТНЫЕ ПИКСЕЛИ: строки объекта, над которыми луч прошёл МЕЖДУ стиранием и
//      выводом (объект в этот момент на экране отсутствует), в разбивке по зонам Ytop;
//   4) ПЛАВНОСТЬ: кадров, где игровой тик (H_TIMI) кончился позже своего кадра.
// Разрез по слотам тот же, что в mummy_survey.js: 0-3 ворота, 4-5 герой, 6-13 мумии,
// 15-18 нож, 19-20 карта.
// Запуск: node tools/verify/beam_late.js [rom] [sym] [кадров]
//         node tools/verify/beam_late.js [rom] [sym] --ticks N   ← для A/B сборок
//
// ===== АУДИТ МЕТРИК 2026-08-09 (правки + инструкция другому агенту) ==================
// ЧТО ПОЧИНЕНО ЗДЕСЬ:
//   SHOW читал lo0/ncols из ШАПКИ save-under (pg+2/+3). vec_spr_show рисует из
//   ЗАПИСИ ВЫВОДА (pg+0x98/+0x99) — см. vec_sprout.asm ~2985. После save они часто
//   совпадают, но на pending=3 / сдвиге габарита / до обновления шапки — нет.
//   Эталон — beam_ab.js (там SHOW уже брал +0x98). Merge и раньше брал +0x98.
// ОТКАТ: вернуть rd(pg+2)/rd(pg+3) в ветке k==="show" ниже.
// ПРОВЕРКА КОРРЕКТНОСТИ (другому агенту):
//   1) node tools/verify/beam_late.js build/kvalley_8c.rom build/kvalley_8c.sym --ticks 2600
//      и node tools/verify/beam_ab.js build/kvalley_8c.rom build/kvalley_8c.sym 2600
//      → «позже луча»/транзиент по категориям должны совпасть (та же траектория тиков).
//   2) Без --ticks цифры НЕ сравнивать с beam_ab: ввод по кадрам уводит сцену.
//   3) Nested IRQ: при тике > кадра late/transient от fr.irq могут врать — для этого
//      есть beam_late_raster.js (абсолютный rb+BEAM0). Не чинить nested здесь без нужды.
// СЛЕПОТА (не баг этой правки): байтовая дыра ≠ цвет лица → beam_color / hero_atomic.
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||8000);
const E=make(ROM,SYM);
// В режиме --ticks в геймплей приводит САМО расписание ввода (то же, что в
// spr_same_footprint.js), поэтому toGame не нужен: он увёл бы сборку в другую сцену.
const TICKARG=process.argv.indexOf("--ticks");
if(TICKARG<0&&toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
const FR=59904;
const ISR=L.vec_isr,OUT=L.vec_spr_out,TICK=L.H_TIMI,SHOW=L.vec_spr_show,REST=L.vec_su_restore;
// ЗАДАЧА#37 ШАГ 3: слитая запись (vso_merge1) выводит объект БЕЗ стирания и без сейва,
// то есть промежуточного состояния у него не бывает в принципе. Считаем такие объекты
// наравне с обычными (иначе метрика ослепнет и покажет ложное улучшение), но с te=-1:
// транзиента у них нет по построению, а «позже луча» проверяется как у всех.
const MERGE=L.vso_merge1;
// ЗАДАЧА#43: верх поля приходит НЕ на фиксированном такте — его сдвигает аппаратный
// вертикальный скролл. Берём vec_vscroll из .sym: каждая лишняя статичная строка
// сверху = +192 такта до прихода луча (0x1F = поле по центру, 0x3F = прижато к низу).
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));

// ЗАДАЧА#38: ЧЕРЕДОВАНИЕ ПАРЫ. У пары объектов (герой: p1+p2 в одной точке) vso_merge1
// делает ТОЛЬКО подготовку, а запись в fb идёт потом, вперемежку по столбцам, в vpr_wr.
// Если оставить t1 = возврат из merge1, метрика показала бы ЛОЖНОЕ улучшение «позже луча»:
// объект якобы готов раньше, чем его байты легли в экран. Поэтому у отложенных объектов
// t1 = конец vpr_wr (признак отложенности — ненулевой vpr_def на возврате из merge1).
const PAIRW=L.vpr_wr;
let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
let cur=null;const frames=[];let pend=[];
const B={out:{pc:OUT},tick:{pc:TICK},show:{pc:SHOW},merge:{pc:MERGE},pairw:{pc:PAIRW}};
for(const k in B){B[k].ret=-1;B[k].sp=-1;}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0){
    if(cur)frames.push(cur);
    cur={irq:TT,outS:-1,outE:-1,tickE:-1,er:{},draws:[],gs:rd(L.GameStatus)};}
  if(!cur)return false;
  for(const k in B){const b=B[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();
      if(k==="out")cur.outS=TT;
      // 2026-08-09: геометрия ВЫВОДА — pg+0x98/+0x99 (не шапка +2/+3). Откат: +2/+3.
      if(k==="show"){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
        b.d={i,t0:TT,lo0:rd(pg+0x98),nc:rd(pg+0x99),te:cur.er[i]!==undefined?cur.er[i]:-1};}
      if(k==="merge"){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
        b.d={i,t0:TT,lo0:rd(pg+0x98),nc:rd(pg+0x99),te:-1};}}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;
      if(k==="out")cur.outE=TT;
      else if(k==="tick")cur.tickE=TT;
      else if(k==="pairw"){for(const d of pend){d.t1=TT;cur.draws.push(d);}pend=[];}
      else if(k==="merge"&&PAIRW&&rd(L.vpr_def))pend.push(b.d);   // запись отложена в vpr_wr
      else if(k==="show"||k==="merge"){b.d.t1=TT;cur.draws.push(b.d);}}}
  if(pc===REST){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256; if(rd(pg))cur.er[i]=TT;}
  return false;};
// РЕЖИМ ИГРОВЫХ ТИКОВ (--ticks N, 2026-08-03). Правка, которая МЕНЯЕТ ТАКТЫ, уводит
// траекторию: при вводе «по кадрам» две сборки к тому же номеру кадра приходят в РАЗНЫХ
// сценах (замер: 1203 объекта против 1402), и сравнивать их транзиенты бессмысленно.
// В режиме тиков ввод подаётся ПО ПРИРАЩЕНИЮ `timer` тем же расписанием, что в
// spr_same_footprint.js, и обе сборки проходят одну и ту же игру тик-в-тик.
const TICKS=TICKARG>0?+(process.argv[TICKARG+1]||2600):0;
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);}
  else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);}
  else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);}
  else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);}
  else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);}
  return k;}
if(TICKS){
  let heldS=new Set(),tick=0,prevT=0,nf=0;
  while(tick<=TICKS&&nf<400000){
    const want=new Set(keysFor(tick));
    for(const c of heldS)if(!want.has(c))E.key(c,0);
    for(const c of want)if(!heldS.has(c))E.key(c,1);
    heldS=want;
    if(cur)cur.gs=rd(L.GameStatus);
    v06c.oneInterrupt(true);nf++;
    const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}
  }
  for(const c of heldS)E.key(c,0);
} else {
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  if(cur)cur.gs=rd(L.GameStatus);
  v06c.oneInterrupt(true);
}
if(held>0)E.key(held,0);
}
if(cur)frames.push(cur);

const cat=i=>i<4?"ворота":i<6?"герой":i<14?"мумии":i<19?"нож":"карта";
const cats=["ворота","герой","мумии","нож","карта"];
const late={},tot={};for(const c of cats){late[c]=0;tot[c]=0;}
const zones=[[0,48],[48,64],[64,96],[96,192]];
const zpx=zones.map(()=>0);let tornPx=0,tornObj=0,objs=0;
const outS=[],outE=[];let gsFrames=0,tickLong=0,tickEnd=[];
for(const fr of frames){
  if(fr.gs!==5)continue;
  gsFrames++;
  if(fr.tickE>=0){const d=fr.tickE-fr.irq;tickEnd.push(d);if(d>FR)tickLong++;}
  if(fr.outS>=0&&fr.outE>=0&&fr.draws.length){outS.push(fr.outS-fr.irq);outE.push(fr.outE-fr.irq);}
  for(const d of fr.draws){
    if(!d.nc)continue;
    const Ytop=255-(d.lo0+15); if(Ytop<0||Ytop>190)continue;
    const c=cat(d.i);tot[c]++;objs++;
    if(d.t1-fr.irq > BEAM0+192*Ytop)late[c]++;
    if(d.te<0)continue;
    let px=0;
    for(let k=0;k<16;k++){const Y=Ytop+k;const bt=fr.irq+BEAM0+192*Y;
      if(bt>d.te&&bt<d.t1)px+=d.nc*8;}
    if(px){tornObj++;tornPx+=px;
      for(let z=0;z<zones.length;z++)if(Ytop>=zones[z][0]&&Ytop<zones[z][1])zpx[z]+=px;}
  }
}
const st=a=>{if(!a.length)return"—";a=a.slice().sort((x,y)=>x-y);
  return `avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0)} p50 ${a[a.length>>1]} p90 ${a[(a.length*0.9)|0]}`;};
console.log(`ROM=${ROM.split("/").pop()} кадров геймплея ${gsFrames}, объектов выведено ${objs}`);
console.log(`ПАЧКА: старт ${st(outS)} | конец ${st(outE)}   (луч на верх поля — такт ${BEAM0})`);
console.log(`ПЛАВНОСТЬ: тик кончается ${st(tickEnd)}; кадров с тиком ДЛИННЕЕ кадра: ${tickLong} (${(100*tickLong/gsFrames).toFixed(1)}%)`);
console.log(`ПОЗЖЕ ЛУЧА (последний байт объекта после луча над его Ytop):`);
for(const c of cats)if(tot[c])console.log(`   ${c.padEnd(8)} ${String(late[c]).padStart(6)} / ${String(tot[c]).padStart(6)} = ${(100*late[c]/tot[c]).toFixed(1)}%`);
console.log(`ТРАНЗИЕНТ (луч между стиранием и выводом): ${tornObj} объектов, ${tornPx} пикс`);
zones.forEach((z,i)=>console.log(`   Ytop ${String(z[0]).padStart(3)}..${String(z[1]-1).padStart(3)}: ${zpx[i]} пикс`));
