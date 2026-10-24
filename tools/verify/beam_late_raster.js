// beam_late_raster.js — ТО ЖЕ, ЧТО beam_late.js, НО ЧАСЫ ЛУЧА — РАСТРОВЫЕ.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ИНСТРУМЕНТ. beam_late.js отсчитывает момент луча от ВХОДА В ISR
// ГЛУБИНЫ 0: `d.t1 - fr.irq > BEAM0 + 192*Ytop`. Пока тик влезал в кадр, это было
// одно и то же. Но когда тик ДЛИННЕЕ кадра, пачку выводит ВЛОЖЕННОЕ прерывание — то
// есть уже СЛЕДУЮЩИЙ растровый кадр, — а fr.irq остаётся от ПРЕДЫДУЩЕГО. Разность
// получается ~61 тыс. тактов и БОЛЬШЕ любого порога 13780+192*Ytop, поэтому beam_late
// метит такие объекты «позже луча» и «транзиентными» ВСЕГДА, независимо от того, где
// на самом деле был луч. Замер burst_raster_phase.js: пачка стартует на растровой фазе
// avg 2082, max 2876 — позже луча (13780) не стартовала НИ РАЗУ, в том числе с
// вложенного прерывания (там фаза даже меньше: 1574, шапка короче).
//
// Здесь момент луча над строкой Y берётся в АБСОЛЮТНОМ времени: rb + BEAM0 + 192*Y,
// где rb — начало ТОГО растрового кадра, в котором событие произошло (rb = TT - cyc()).
// Транзиент считается перебором всех растровых кадров между стиранием и выводом, так
// что многокадровые дыры видны честно, а не сливаются в одну.
//
// Запуск: node tools/verify/beam_late_raster.js [rom] [sym] --ticks N
//
// ===== АУДИТ МЕТРИК 2026-08-09 ========================================================
// ЧТО ПОЧИНЕНО: SHOW читал lo0/ncols из шапки save-under (pg+2/+3). Рисует vec_spr_show
// из записи вывода pg+0x98/+0x99 (как merge уже читал). Эталон — beam_ab.js.
// ОТКАТ: в ветке k==="show" вернуть rd(pg+2)/rd(pg+3).
// ПРОВЕРКА: на --ticks 2600 сравнить late%/транзиент с beam_late.js --ticks 2600 —
// late% у raster должен быть ≤ late% у beam_late (nested false-late срезаны); геометрия
// Ytop объектов (кто попал в tot[]) должна совпасть по слотам с beam_ab.
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const E=make(ROM,SYM);
const TICKARG=process.argv.indexOf("--ticks");
if(TICKARG<0&&toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu,cyc}=E;
const FR=59904, BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));
const ISR=L.vec_isr,OUT=L.vec_spr_out,TICK=L.H_TIMI,SHOW=L.vec_spr_show,REST=L.vec_su_restore,
      MERGE=L.vso_merge1,PAIRW=L.vpr_wr;
let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
const now=()=>({t:TT,rb:TT-cyc()});           // абсолютный такт + начало текущего растрового кадра
let cur=null;const frames=[];let pend=[];
const B={out:{pc:OUT},tick:{pc:TICK},show:{pc:SHOW},merge:{pc:MERGE},pairw:{pc:PAIRW}};
for(const k in B){B[k].ret=-1;B[k].sp=-1;}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0){
    if(cur)frames.push(cur);
    cur={irq:TT,outS:-1,tickE:-1,er:{},draws:[],gs:rd(L.GameStatus)};}
  if(!cur)return false;
  for(const k in B){const b=B[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();
      if(k==="out")cur.outS=TT;
      // 2026-08-09: геометрия ВЫВОДА — pg+0x98/+0x99 (не шапка +2/+3). Откат: +2/+3.
      if(k==="show"){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
        b.d={i,lo0:rd(pg+0x98),nc:rd(pg+0x99),te:cur.er[i]!==undefined?cur.er[i]:null};}
      if(k==="merge"){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
        b.d={i,lo0:rd(pg+0x98),nc:rd(pg+0x99),te:null};}}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;
      if(k==="tick")cur.tickE=TT;
      else if(k==="pairw"){const n=now();for(const d of pend){d.d1=n;cur.draws.push(d);}pend=[];}
      else if(k==="merge"&&PAIRW&&rd(L.vpr_def))pend.push(b.d);
      else if(k==="show"||k==="merge"){b.d.d1=now();cur.draws.push(b.d);}}}
  if(pc===REST){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256; if(rd(pg))cur.er[i]=now();}
  return false;};
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
const TICKS=TICKARG>0?+(process.argv[TICKARG+1]||2600):0;
if(TICKS){
  let heldS=new Set(),tick=0,prevT=0,nf=0;
  while(tick<=TICKS&&nf<400000){
    const want=new Set(keysFor(tick));
    for(const c of heldS)if(!want.has(c))E.key(c,0);
    for(const c of want)if(!heldS.has(c))E.key(c,1);
    heldS=want;
    if(cur)cur.gs=rd(L.GameStatus);
    v06c.oneInterrupt(true);nf++;
    const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}}
  for(const c of heldS)E.key(c,0);
}else{
  let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);let held=-1;
  for(let f=0;f<8000;f++){
    if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
      if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
    if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
    if(cur)cur.gs=rd(L.GameStatus);
    v06c.oneInterrupt(true);}
  if(held>0)E.key(held,0);
}
if(cur)frames.push(cur);

const cat=i=>i<4?"ворота":i<6?"герой":i<14?"мумии":i<19?"нож":"карта";
const cats=["ворота","герой","мумии","нож","карта"];
const late={},tot={};for(const c of cats){late[c]=0;tot[c]=0;}
const zones=[[0,48],[48,64],[64,96],[96,192]];
const zpx=zones.map(()=>0);let tornPx=0,tornObj=0,objs=0;
let gsFrames=0,tickLong=0;const tickEnd=[],outPhase=[];
for(const fr of frames){
  if(fr.gs!==5)continue;
  gsFrames++;
  if(fr.tickE>=0){const d=fr.tickE-fr.irq;tickEnd.push(d);if(d>FR)tickLong++;}
  for(const d of fr.draws){
    if(!d.nc)continue;
    const Ytop=255-(d.lo0+15); if(Ytop<0||Ytop>190)continue;
    const c=cat(d.i);tot[c]++;objs++;
    // «позже луча»: луч над верхней строкой объекта В ТОМ ЖЕ растровом кадре, где объект дописан
    if(d.d1.t > d.d1.rb+BEAM0+192*Ytop)late[c]++;
    if(!d.te)continue;
    // транзиент: перебираем растровые кадры от стирания до вывода
    let px=0;
    for(let rb=d.te.rb;rb<=d.d1.rb;rb+=FR)
      for(let k=0;k<16;k++){const bt=rb+BEAM0+192*(Ytop+k);
        if(bt>d.te.t&&bt<d.d1.t)px+=d.nc*8;}
    if(px){tornObj++;tornPx+=px;
      for(let z=0;z<zones.length;z++)if(Ytop>=zones[z][0]&&Ytop<zones[z][1])zpx[z]+=px;}
  }
}
const st=a=>{if(!a.length)return"—";a=a.slice().sort((x,y)=>x-y);
  return `avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0)} p50 ${a[a.length>>1]} p90 ${a[(a.length*0.9)|0]}`;};
console.log(`ROM=${ROM.split("/").pop()} кадров геймплея ${gsFrames}, объектов выведено ${objs}`);
console.log(`ПЛАВНОСТЬ: тик кончается ${st(tickEnd)}; кадров с тиком ДЛИННЕЕ кадра: ${tickLong} (${(100*tickLong/gsFrames).toFixed(1)}%)`);
console.log(`ПОЗЖЕ ЛУЧА (растровые часы; последний байт объекта после луча над его Ytop):`);
for(const c of cats)if(tot[c])console.log(`   ${c.padEnd(8)} ${String(late[c]).padStart(6)} / ${String(tot[c]).padStart(6)} = ${(100*late[c]/tot[c]).toFixed(1)}%`);
console.log(`ТРАНЗИЕНТ (луч между стиранием и выводом): ${tornObj} объектов, ${tornPx} пикс`);
zones.forEach((z,i)=>console.log(`   Ytop ${String(z[0]).padStart(3)}..${String(z[1]-1).padStart(3)}: ${zpx[i]} пикс`));
