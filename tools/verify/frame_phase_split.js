// frame_phase_split.js — ИЗ ЧЕГО СОСТОИТ «СОБСТВЕННАЯ РАБОТА КАДРА» (задача #53).
//
// Делит такты от входа в ISR глубины 0 до возврата из H_TIMI на четыре части:
//   ШАПКА   — от входа в ISR до входа в пачку (vec_spr_out);
//   ПАЧКА   — vec_spr_out + починка vfr_gate (обёртка vso_fix);
//   ХВОСТ   — от возврата из пачки до входа в H_TIMI (flushvi, клавиши-читы, compose);
//   ТИК     — сам H_TIMI, а внутри него отдельно ПОДГОТОВКА (vec_spr_prep).
// Вложенные прерывания (глубина >=2) исключены из всех колонок — см. tick_gain_curve.js.
// Плюс разрез по кадрам «уложился / не уложился» и число объектов в пачке.
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const TICKS=+(process.argv[4]||1200);
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
const FR=59904;
const ISR=L.vec_isr,OUT=L.vec_spr_out,FIX=L.vso_fix,TICK=L.H_TIMI,PREP=L.vec_spr_prep;
const DPTH=L.vec_isr_depth;
let TT=0,own=0;
const oI=cpu.instruction.bind(cpu);
let live=false;
cpu.instruction=function(){oI();const d=cpu.vcycles|0;TT+=d;if(live&&rd(DPTH)<2)own+=d;};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
let cur=null;const frames=[];
const B={fix:{pc:FIX},tick:{pc:TICK},prep:{pc:PREP}};
for(const k in B){B[k].ret=-1;B[k].sp=-1;}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(DPTH)===0){
    if(cur)frames.push(cur);
    cur={gs:rd(L.GameStatus),head:-1,burst:0,tail:0,tick:0,prep:0,own:-1,nobj:0,work:0};
    own=0;live=true;}
  if(!cur)return false;
  // ВЛОЖЕННЫЕ ВЫЗОВЫ НЕ СЧИТАЕМ. Пачка зовётся и с глубины 2 (посреди тика): без этого
  // гейта её вход перезаписывал бы cur.head серединой тика, и разбивка не сходилась
  // с суммой (замер до гейта: шапка avg 32173 при полной работе 59790).
  if(rd(DPTH)>=2)return false;
  for(const k in B){const b=B[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();b.t0=own;
      if(k==="fix"){cur.head=own;cur.work=(rd(L.vsp_rdy)!==0&&rd(L.vsp_n)!==0)?1:0;cur.nobj=cur.work?rd(L.vsp_n):0;}
      if(k==="tick")cur.tail=own-cur.burstEnd;}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;
      if(k==="fix"){cur.burst=own-b.t0;cur.burstEnd=own;}
      else if(k==="prep")cur.prep+=own-b.t0;
      else if(k==="tick"){cur.tick=own-b.t0;cur.own=own;live=false;}}}
  return false;};
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);} else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);} else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);} else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);} else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);} return k;}
{let heldS=new Set(),tick=0,prevT=0,nf=0;
 while(tick<=TICKS&&nf<400000){
   const want=new Set(keysFor(tick));
   for(const c of heldS)if(!want.has(c))E.key(c,0);
   for(const c of want)if(!heldS.has(c))E.key(c,1);
   heldS=want; if(cur)cur.gs=rd(L.GameStatus);
   v06c.oneInterrupt(true);nf++;
   const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}}
 for(const c of heldS)E.key(c,0);}
if(cur)frames.push(cur);
const F=frames.filter(f=>f.gs===5&&f.own>=0&&f.head>=0);
const N=F.length;
const av=g=>F.reduce((s,f)=>s+g(f),0)/N;
const p=(a,q)=>{const b=a.slice().sort((x,y)=>x-y);return b[(b.length*q)|0];};
console.log(`кадров геймплея ${N}; опоздавших ${F.filter(f=>f.own>FR).length} (${(100*F.filter(f=>f.own>FR).length/N).toFixed(1)}%)`);
function row(name,g){const a=F.map(g);
  console.log(`  ${name.padEnd(28)} avg ${av(g).toFixed(0).padStart(6)}  p50 ${String(p(a,0.5)).padStart(6)}  p90 ${String(p(a,0.9)).padStart(6)}  доля ${(100*av(g)/av(f=>f.own)).toFixed(1)}%`);}
console.log(`\n=== РАЗБИВКА СОБСТВЕННОЙ РАБОТЫ КАДРА (без вложенных ISR) ===`);
row("ВСЕГО",f=>f.own);
row("шапка ISR (до пачки)",f=>f.head);
row("ПАЧКА vso_fix",f=>f.burst);
row("хвост ISR (пачка->тик)",f=>f.tail);
row("ТИК H_TIMI",f=>f.tick);
row("  в т.ч. подготовка vec_spr_prep",f=>f.prep);
const W=F.filter(f=>f.work),I=F.filter(f=>!f.work);
console.log(`\nпачка с работой: ${W.length}/${N} (${(100*W.length/N).toFixed(1)}%), объектов avg ${(W.reduce((s,f)=>s+f.nobj,0)/(W.length||1)).toFixed(1)}`);
console.log(`  ПАЧКА в рабочих кадрах: avg ${(W.reduce((s,f)=>s+f.burst,0)/(W.length||1)).toFixed(0)}  p90 ${p(W.map(f=>f.burst),0.9)}`);
console.log(`  ПАЧКА в холостых кадрах: avg ${(I.reduce((s,f)=>s+f.burst,0)/(I.length||1)).toFixed(0)}`);
const LA=F.filter(f=>f.own>FR),OK=F.filter(f=>f.own<=FR);
console.log(`\n=== ОПОЗДАВШИЕ против УЛОЖИВШИХСЯ ===`);
for(const [nm,g] of [["ВСЕГО",f=>f.own],["шапка",f=>f.head],["ПАЧКА",f=>f.burst],["хвост",f=>f.tail],["ТИК",f=>f.tick],["подготовка",f=>f.prep]])
  console.log(`  ${nm.padEnd(12)} опоздавшие avg ${(LA.reduce((s,f)=>s+g(f),0)/LA.length).toFixed(0).padStart(6)}   уложившиеся avg ${(OK.reduce((s,f)=>s+g(f),0)/OK.length).toFixed(0).padStart(6)}`);
console.log(`  пачка с работой: опоздавшие ${(100*LA.filter(f=>f.work).length/LA.length).toFixed(1)}%, уложившиеся ${(100*OK.filter(f=>f.work).length/OK.length).toFixed(1)}%`);
