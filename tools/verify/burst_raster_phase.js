// burst_raster_phase.js — ГДЕ В РАСТРОВОМ КАДРЕ РЕАЛЬНО СТАРТУЕТ ПАЧКА (задача #53).
//
// ЗАЧЕМ. beam_late меряет старт пачки от ВХОДА В ISR ГЛУБИНЫ 0 — а когда тик длиннее
// кадра, пачку выводит ВЛОЖЕННОЕ прерывание, и его «старт 61424» относительно чужого
// кадра ничего не говорит о луче. Луч живёт по РАСТРОВЫМ часам: E.cyc() = такты от
// запроса прерывания текущего кадра, поле начинается на 13780.
// Печатает по каждому вызову vec_spr_out: фазу растра на входе, глубину ISR, и
// ЗАДЕРЖКУ ПРЕРЫВАНИЯ (сколько тактов от запроса IRQ до входа в vec_isr) — именно
// её раздувают DI-участки тика.
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const TICKS=+(process.argv[4]||1200);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu,cyc}=E;
const ISR=L.vec_isr,OUT=L.vec_spr_out;
const BEAM0=13780;

const outs=[],lat=[],outsD=[],ends=[],dur=[];let gs=0,work=0,idle=0;
const memory=E.memory;
let oret=-1,osp=-1,ost=0,owork=false;
let TT=0;const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(gs!==5)return false;
  if(pc===ISR)lat.push(cyc());
  if(pc===OUT&&oret<0){const d=rd(L.vec_isr_depth);outs.push(cyc());outsD.push(d);
    osp=cpu.sp;oret=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
    ost=TT;owork=rd(L.vsp_rdy)!==0&&rd(L.vsp_n)!==0;}
  else if(oret>=0&&pc===oret&&cpu.sp>osp){oret=-1;
    if(owork){work++;ends.push(cyc());dur.push(TT-ost);}else idle++;}
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
{let heldS=new Set(),tick=0,prevT=0,nf=0;
 while(tick<=TICKS&&nf<400000){
   const want=new Set(keysFor(tick));
   for(const c of heldS)if(!want.has(c))E.key(c,0);
   for(const c of want)if(!heldS.has(c))E.key(c,1);
   heldS=want;
   gs=rd(L.GameStatus);
   v06c.oneInterrupt(true);nf++;
   const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}}
 for(const c of heldS)E.key(c,0);}

const st=a=>{if(!a.length)return"—";const b=a.slice().sort((x,y)=>x-y);
  return `avg ${(b.reduce((s,v)=>s+v,0)/b.length).toFixed(0)} p50 ${b[b.length>>1]} p90 ${b[(b.length*0.9)|0]} max ${b[b.length-1]}`;};
console.log(`вызовов пачки ${outs.length}, входов в ISR ${lat.length}  (луч на верх поля — такт ${BEAM0})`);
console.log(`ЗАДЕРЖКА ПРЕРЫВАНИЯ (запрос IRQ -> вход в vec_isr): ${st(lat)}`);
console.log(`  задержек > 1000 т: ${lat.filter(v=>v>1000).length} (${(100*lat.filter(v=>v>1000).length/lat.length).toFixed(1)}%)`);
console.log(`  задержек > 5000 т: ${lat.filter(v=>v>5000).length} (${(100*lat.filter(v=>v>5000).length/lat.length).toFixed(1)}%)`);
console.log(`ФАЗА РАСТРА НА СТАРТЕ ПАЧКИ: ${st(outs)}`);
console.log(`  пачек, стартовавших ПОЗЖЕ ЛУЧА над верхом поля (${BEAM0}): ${outs.filter(v=>v>BEAM0).length} (${(100*outs.filter(v=>v>BEAM0).length/outs.length).toFixed(1)}%)`);
console.log(`ПАЧКА С РАБОТОЙ: ${work} из ${work+idle} (${(100*work/(work+idle)).toFixed(1)}%); холостых (vsp_rdy=0/список пуст): ${idle}`);
console.log(`ДЛИТЕЛЬНОСТЬ работающей пачки: ${st(dur)}`);
console.log(`ФАЗА РАСТРА НА КОНЦЕ работающей пачки: ${st(ends)}`);
console.log(`  кончились ПОЗЖЕ верха поля (${BEAM0}): ${ends.filter(v=>v>BEAM0).length} (${(100*ends.filter(v=>v>BEAM0).length/ends.length).toFixed(1)}%)`);
for(const d of [1,2,3]){const s=outs.filter((v,i)=>outsD[i]===d);
  if(s.length)console.log(`  глубина ${d}: ${s.length} шт, фаза ${st(s)}, позже ${BEAM0}: ${(100*s.filter(v=>v>BEAM0).length/s.length).toFixed(1)}%`);}
