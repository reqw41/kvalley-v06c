// beam_ab.js — ДЕТЕРМИНИРОВАННЫЙ A/B по лучу (задача #37).
// ЗАЧЕМ. beam_late.js подаёт клавиши ПО НОМЕРУ КАДРА, поэтому правка, меняющая такты,
// уводит траекторию: две сборки играют РАЗНЫЕ сцены, и сравнивать их «плавность» нельзя
// (в замере #37 это дало 3167 против 2067 кадров геймплея на тех же 8000 кадрах).
// Здесь клавиши — ФУНКЦИЯ ИГРОВОГО ТИКА (как в coltab_frame_parity.js), поэтому обе
// сборки проходят ОДНУ И ТУ ЖЕ игру, и все цифры сопоставимы напрямую.
// Считает на диапазоне тиков: транзиент по зонам Ytop, «позже луча», окно пачки,
// кадров на игру (прямая мера плавности) и долю кадров с тиком длиннее кадра.
// Запуск: node tools/verify/beam_ab.js <rom> <sym> [тиков=2600]
//
// ===== АУДИТ МЕТРИК 2026-08-09 ========================================================
// ЭТАЛОН геометрии SHOW/MERGE (pg+0x98/+0x99) и pairw — другие инструменты выровняли
// сюда. Этот файл НЕ меняли. ПРОВЕРКА правок в beam_late/top/raster: на 2600 тиках
// late%/транзиент beam_late --ticks должны совпасть с этим выводом. Откат эталона
// не требуется; если «починка» ломает совпадение — откатывать ПРАВКУ, не beam_ab.
"use strict";
const {make}=require("./beam_harness.js");
const ROM=process.argv[2],SYM=process.argv[3],NT=+(process.argv[4]||2600);
if(!ROM||!SYM){console.log("usage: node beam_ab.js <rom> <sym> [тиков]");process.exit(2);}
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu,keyboard}=E;
// БЫЛО зашито 0x6C03 (эра 0x6C00) — теперь адрес переменной timer берём из .sym по имени.
if(!L.timer){console.log("нет символа timer в .sym");process.exit(2);}
const TIMER=L.timer,FR=59904;
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

// ЗАДАЧА#38: ЧЕРЕДОВАНИЕ ПАРЫ. У пары (герой: p1+p2 в одной точке) vso_merge1 делает
// только подготовку, а запись в fb идёт потом вперемежку по столбцам, в vpr_wr. Без этого
// t1 брался бы с возврата из merge1 и метрика показала бы ЛОЖНОЕ улучшение «позже луча».
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
// СЦЕНАРИЙ «НОЖ» (задача #46, 4-й аргумент = knife): штатная раскладка ниже НИ РАЗУ не
// жмёт FIRE, поэтому нож в ней не бросают вовсе и путь отскока/падения не исполняется.
// Здесь — бег с импульсами FIRE и ножом в руке (форс objetoCogido, как в knife_cost.js;
// ГРАБЛИ форса там же: нож даём только когда он свободен, иначе бросок перехватывает его
// посреди отскока и оставляет спрайт-призрак).
const KNIFE=process.argv[5]==="knife";
function keysKnife(t){const k=[];
  if(t<260){if((t>>2)&1)k.push(32);return k;}
  if((t&31)<16)k.push(39);else k.push(37);
  if((t&15)===3)k.push(32);
  return k;}
// та же раскладка клавиш по тикам, что в coltab_frame_parity.js
function keysFor(t){if(KNIFE)return keysKnife(t);const k=[];
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
let held=new Set(),tick=0,prevT=0,nframes=0;
while(tick<=NT&&nframes<400000){
  const want=new Set(keysFor(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  if(KNIFE&&tick>=260){const st=rd(L.knifesData);
    if(st<=2){memory.write(L.objetoCogido,0x10,false);memory.write(L.IDcuchilloCoge,0,false);}}
  if(cur)cur.gs=rd(L.GameStatus);
  v06c.oneInterrupt(true);nframes++;
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
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
    if(d.t1-fr.irq>BEAM0+192*Ytop)late[c]++;
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
console.log(`ROM=${ROM.split("/").pop()} тиков ${NT}, КАДРОВ НА ИГРУ ${nframes}, кадров геймплея ${gsFrames}, объектов ${objs}`);
console.log(`ПАЧКА: старт ${st(outS)} | конец ${st(outE)}   (луч на верх поля — такт ${BEAM0})`);
console.log(`ПЛАВНОСТЬ: тик кончается ${st(tickEnd)}; кадров с тиком ДЛИННЕЕ кадра: ${tickLong} (${(100*tickLong/gsFrames).toFixed(1)}%)`);
console.log(`ПОЗЖЕ ЛУЧА:`);
for(const c of cats)if(tot[c])console.log(`   ${c.padEnd(8)} ${String(late[c]).padStart(6)} / ${String(tot[c]).padStart(6)} = ${(100*late[c]/tot[c]).toFixed(1)}%`);
console.log(`ТРАНЗИЕНТ: ${tornObj} объектов, ${tornPx} пикс`);
zones.forEach((z,i)=>console.log(`   Ytop ${String(z[0]).padStart(3)}..${String(z[1]-1).padStart(3)}: ${zpx[i]} пикс`));
