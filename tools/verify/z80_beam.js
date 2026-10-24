// z80_beam.js (ветка от beam_late.js) — успевает ли пачка вывода за лучом на гипотетической
// таблице тактов Z80 (сравнительный what-if, не приёмка железа 8080).
// Модель луча / метрики — как у beam_late.js. Ввод по КАДРАМ (как дефолт beam_late) —
// для A/B правок asm использовать beam_ab / beam_late --ticks.
// Запуск: node tools/verify/z80_beam.js [rom] [sym] [кадров]
//
// ===== АУДИТ МЕТРИК 2026-08-09 ========================================================
// ЧТО ПОЧИНЕНО: SHOW читал lo0/ncols из шапки (pg+2/+3); рисует из pg+0x98/+0x99.
// ОТКАТ: в ветке k==="show" вернуть rd(pg+2)/rd(pg+3).
// ПРОВЕРКА: на той же ROM цифры 8080-колонки (TT) должны быть близки к beam_late без
// --ticks (тот же frame-keyed ввод); расхождение только из-за SHOW-геометрии на медленном
// пути. Nested-IRQ false-late наследуется от beam_late — это не регрессия этой правки.
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||8000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
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
let TT=0,TZ=0;
// --- цена инструкции на Z80 при той же шине Вектора (см. z80_gain.js) ---
function z80info(op,taken){
  if(op===0x76)return[4,0,0];
  if(op>=0x40&&op<0x80)return((op&7)===6||(op&0x38)===0x30)?[7,1,0]:[4,0,0];
  if(op>=0x80&&op<0xC0)return((op&7)===6)?[7,1,0]:[4,0,0];
  switch(op){
    case 0x00:case 0x07:case 0x0F:case 0x17:case 0x1F:
    case 0x27:case 0x2F:case 0x37:case 0x3F:
    case 0xE9:case 0xEB:case 0xF3:case 0xFB: return[4,0,0];
    case 0x01:case 0x11:case 0x21:case 0x31: return[10,2,0];
    case 0x02:case 0x12:case 0x0A:case 0x1A: return[7,1,0];
    case 0x22:case 0x2A: return[16,4,0];
    case 0x32:case 0x3A: return[13,3,0];
    case 0x03:case 0x13:case 0x23:case 0x33:
    case 0x0B:case 0x1B:case 0x2B:case 0x3B: return[6,0,0];
    case 0x34:case 0x35: return[11,2,0];
    case 0x36: return[10,2,0];
    case 0x09:case 0x19:case 0x29:case 0x39: return[11,0,0];
    case 0xE3: return[19,4,0];
    case 0xF9: return[6,0,0];
    case 0xC9: return[10,2,0];
    case 0xCD: return[17,4,0];
    case 0xC3: return[10,2,0];
    case 0xD3:case 0xDB: return[11,1,1];
  }
  if((op&0xC7)===0x04||(op&0xC7)===0x05)return[4,0,0];
  if((op&0xC7)===0x06)return[7,1,0];
  if((op&0xC7)===0xC6)return[7,1,0];
  if((op&0xC7)===0xC7)return[11,2,0];
  if((op&0xCF)===0xC1)return[10,2,0];
  if((op&0xCF)===0xC5)return[11,2,0];
  if((op&0xC7)===0xC2)return[10,2,0];
  if((op&0xC7)===0xC4)return taken?[17,4,0]:[10,2,0];
  if((op&0xC7)===0xC0)return taken?[11,2,0]:[5,0,0];
  return null;
}
function cz80(op,taken){const it=z80info(op,taken);if(!it)return 12;
  const[t,mem,prt]=it;const inner=t-4-3*mem-4*prt;
  return 4*(1+mem+prt+(inner>0?Math.ceil(inner/4):0));}
const ZT=new Int16Array(256),ZTt=new Int16Array(256);
for(let o=0;o<256;o++){ZT[o]=cz80(o,false);ZTt[o]=cz80(o,true);}
const isCond=op=>((op&0xC7)===0xC4)||((op&0xC7)===0xC0);
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){const pc=cpu.pc;oI();const vc=cpu.vcycles|0,op=rd(pc);
  TT+=vc; TZ+=isCond(op)?((((op&0xC7)===0xC4)?(vc>=16):(vc>=12))?ZTt[op]:ZT[op]):ZT[op];};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
let cur=null;const frames=[];let pend=[];
const B={out:{pc:OUT},tick:{pc:TICK},show:{pc:SHOW},merge:{pc:MERGE},pairw:{pc:PAIRW}};
for(const k in B){B[k].ret=-1;B[k].sp=-1;}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0){
    if(cur)frames.push(cur);
    cur={irq:TT,irqz:TZ,outS:-1,outE:-1,tickE:-1,tickEz:-1,er:{},erz:{},draws:[],gs:rd(L.GameStatus)};}
  if(!cur)return false;
  for(const k in B){const b=B[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();
      if(k==="out"){cur.outS=TT;cur.outSz=TZ;}
      // 2026-08-09: геометрия ВЫВОДА — pg+0x98/+0x99 (не шапка +2/+3). Откат: +2/+3.
      if(k==="show"){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
        b.d={i,t0:TT,t0z:TZ,lo0:rd(pg+0x98),nc:rd(pg+0x99),te:cur.er[i]!==undefined?cur.er[i]:-1,tez:cur.erz[i]!==undefined?cur.erz[i]:-1};}
      if(k==="merge"){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
        b.d={i,t0:TT,t0z:TZ,lo0:rd(pg+0x98),nc:rd(pg+0x99),te:-1,tez:-1};}}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;
      if(k==="out"){cur.outE=TT;cur.outEz=TZ;}
      else if(k==="tick"){cur.tickE=TT;cur.tickEz=TZ;}
      else if(k==="pairw"){for(const d of pend){d.t1=TT;d.t1z=TZ;cur.draws.push(d);}pend=[];}
      else if(k==="merge"&&PAIRW&&rd(L.vpr_def))pend.push(b.d);   // запись отложена в vpr_wr
      else if(k==="show"||k==="merge"){b.d.t1=TT;b.d.t1z=TZ;cur.draws.push(b.d);}}}
  if(pc===REST){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256; if(rd(pg)){cur.er[i]=TT;cur.erz[i]=TZ;}}
  return false;};
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
if(cur)frames.push(cur);

const cat=i=>i<4?"ворота":i<6?"герой":i<14?"мумии":i<19?"нож":"карта";
const cats=["ворота","герой","мумии","нож","карта"];
const zones=[[0,48],[48,64],[64,96],[96,192]];
function metric(Z){
  const late={},tot={};for(const c of cats){late[c]=0;tot[c]=0;}
  const zpx=zones.map(()=>0);let tornPx=0,tornObj=0,objs=0,lateAll=0;
  const outE=[];let gsFrames=0,tickLong=0,tickEnd=[];
  for(const fr of frames){
    if(fr.gs!==5)continue; gsFrames++;
    const irq=Z?fr.irqz:fr.irq, tE=Z?fr.tickEz:fr.tickE;
    if(tE>=0){const d=tE-irq;tickEnd.push(d);if(d>FR)tickLong++;}
    if(fr.outS>=0&&fr.outE>=0&&fr.draws.length)outE.push((Z?fr.outEz:fr.outE)-irq);
    for(const d of fr.draws){
      if(!d.nc)continue;
      const Ytop=255-(d.lo0+15); if(Ytop<0||Ytop>190)continue;
      const c=cat(d.i);tot[c]++;objs++;
      const t1=Z?d.t1z:d.t1, te=Z?d.tez:d.te;
      if(t1-irq > BEAM0+192*Ytop){late[c]++;lateAll++;}
      if(te<0)continue;
      let px=0;
      for(let k=0;k<16;k++){const Y=Ytop+k;const bt=irq+BEAM0+192*Y;
        if(bt>te&&bt<t1)px+=d.nc*8;}
      if(px){tornObj++;tornPx+=px;
        for(let z=0;z<zones.length;z++)if(Ytop>=zones[z][0]&&Ytop<zones[z][1])zpx[z]+=px;}
    }
  }
  return {late,tot,zpx,tornPx,tornObj,objs,lateAll,outE,gsFrames,tickLong,tickEnd};
}
const st=a=>{if(!a.length)return"—";a=a.slice().sort((x,y)=>x-y);
  return `avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0)} p50 ${a[a.length>>1]} p90 ${a[(a.length*0.9)|0]}`;};
const M8=metric(false),MZ=metric(true);
console.log(`ROM=${ROM.split("/").pop()} кадров геймплея ${M8.gsFrames}, объектов выведено ${M8.objs}`);
console.log(`  ЧТО ЭТО: тот же прогон, но каждая инструкция оценена ДВАЖДЫ — тактами i8080 и тактами Z80`);
console.log(`  на шине Вектора. Луч идёт по реальному времени, поэтому «успел/не успел» меняется.`);
for(const [nm,M] of [["i8080",M8],["Z80  ",MZ]]){
  console.log(`\n--- ${nm} ---`);
  console.log(`  ПАЧКА кончается: ${st(M.outE)}   (луч на верх поля — такт ${BEAM0})`);
  console.log(`  ПЛАВНОСТЬ: тик кончается ${st(M.tickEnd)}; кадров с тиком ДЛИННЕЕ кадра: ${M.tickLong} (${(100*M.tickLong/M.gsFrames).toFixed(1)}%)`);
  console.log(`  ПОЗЖЕ ЛУЧА: всего ${M.lateAll}/${M.objs} = ${(100*M.lateAll/M.objs).toFixed(1)}%`);
  for(const c of cats)if(M.tot[c])console.log(`     ${c.padEnd(8)} ${String(M.late[c]).padStart(6)} / ${String(M.tot[c]).padStart(6)} = ${(100*M.late[c]/M.tot[c]).toFixed(1)}%`);
  console.log(`  ТРАНЗИЕНТ: ${M.tornObj} объектов, ${M.tornPx} пикс`);
}
console.log(`\n=== ЧТО ДАЛ БЫ Z80 (тот же код, опкод в опкод) ===`);
console.log(`  позже луча: ${(100*M8.lateAll/M8.objs).toFixed(1)}% -> ${(100*MZ.lateAll/MZ.objs).toFixed(1)}%  (снято ${(100*(M8.lateAll-MZ.lateAll)/M8.lateAll).toFixed(1)}% случаев)`);
console.log(`  транзиент:  ${M8.tornPx} -> ${MZ.tornPx} пикс  (снято ${(100*(M8.tornPx-MZ.tornPx)/M8.tornPx).toFixed(1)}%)`);
console.log(`  плавность:  ${(100*M8.tickLong/M8.gsFrames).toFixed(1)}% -> ${(100*MZ.tickLong/MZ.gsFrames).toFixed(1)}% кадров с тиком длиннее кадра`);
