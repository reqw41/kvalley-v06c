// burst_tail.js — ИЗ ЧЕГО СОСТОИТ ХВОСТ ПАЧКИ (задача#53, критерий p90/max).
//
// ЗАЧЕМ. Владелец с железа: мерцание живёт не в средней пачке, а в ХВОСТЕ (p90 27 тыс.,
// max 46 тыс. против «потолка» 16.9 тыс. у патченного Городецкого). Средние метрики
// (burst_cost) размазывают хвост по всем пачкам и не отвечают, ЧЕМ он набран.
// Здесь каждая ПАЧКА профилируется отдельно: длительность, число объектов, путь каждого
// (слитая запись / многоплоскостная / пара / старый путь), и плоский профиль по меткам
// СЧИТАЕТСЯ ОТДЕЛЬНО для хвостовых пачек (>= p90) и для остальных.
// Запуск: node tools/verify/burst_tail.js [rom] [sym] [тиков=1200]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const TICKS=+(process.argv[4]||1200);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu,memory}=E;
const OUT=L.vec_spr_out;

const marks=[];
for(const k in L){const a=L[k];if(a>=0x0100&&a<0x7600)marks.push([a,k]);}
marks.sort((x,y)=>x[0]-y[0]);
const MAP=new Uint16Array(0x8000);
{let j=0;for(let a=0;a<0x8000;a++){while(j+1<marks.length&&marks[j+1][0]<=a)j++;MAP[a]=j;}}

// счётчики ВХОДОВ в характерные точки — по ним восстанавливаем состав пачки
const PT={vso_merge1:L.vso_merge1,vsm_multi:L.vsm_multi,vpr_wr:L.vpr_wr,vsz_merge:L.vsz_merge,
  vsb_mrow:L.vsb_mrow,vso_prev:L.vso_prev,vec_su_save:L.vec_su_save,vec_su_restore:L.vec_su_restore,
  vsm_shift:L.vsm_shift,vsz_mcol:L.vsz_mcol,vsb_mcol:L.vsb_mcol,vsn_col:L.vsn_col,vsa_row:L.vsa_row,
  vsb_or:L.vsb_or,vsc_merge:L.vsc_merge,vso_fastall:L.vso_fastall};
const PTK=Object.keys(PT).filter(k=>PT[k]!==undefined);
const HOT=new Uint8Array(0x10000);for(const k of PTK)HOT[PT[k]]=1;

let gs=0,inOut=false,oret=-1,osp=0,cur=0,curCnt=null;
const packs=[];
const costCur=new Float64Array(marks.length);
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  if(inOut){const i=MAP[cpu.pc&0x7fff];oI();const c=cpu.vcycles|0;costCur[i]+=c;cur+=c;}
  else oI();
};
let curN=0,curFast=0;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(gs!==5)return false;
  if(pc===OUT&&!inOut){osp=cpu.sp;oret=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
    inOut=true;cur=0;costCur.fill(0);curCnt={};
    // ЧИСЛО ОБЪЕКТОВ БЕРЁМ ИЗ vsp_n, А НЕ ИЗ СЧЁТЧИКОВ МЕТОК (исправлено 2026-08-07).
    // Прежняя формула nobj = vso_merge1 + vso_prev ДВОИЛА объект на СЛИТОМ пути (он
    // проходит обе метки) и не двоила на старом. Отсюда взялись мифические «пачки из
    // 5-8 объектов, дающие весь хвост»: замер vsp_n говорит, что в пачке НИКОГДА не
    // бывает больше ЧЕТЫРЁХ объектов (подготовка режет: слоты 0-5 + бюджет 2).
    curN=rd(L.vsp_rdy)===1?rd(L.vsp_n):0;curFast=rd(L.vsp_fast);}
  else if(inOut&&pc===oret&&cpu.sp>osp){inOut=false;
    packs.push({t:cur,cnt:curCnt,cost:Float64Array.from(costCur),n:curN,fast:curFast});}
  if(inOut&&HOT[pc]){for(const k of PTK)if(pc===PT[k])curCnt[k]=(curCnt[k]||0)+1;}
  return false;};

function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);} else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);} else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);} else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);} else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);} return k;}
{let heldS=new Set(),tick=0,nf=0,prevT=0;
 while(tick<=TICKS&&nf<400000){
   const want=new Set(keysFor(tick));
   for(const c of heldS)if(!want.has(c))E.key(c,0);
   for(const c of want)if(!heldS.has(c))E.key(c,1);
   heldS=want;gs=rd(L.GameStatus);v06c.oneInterrupt(true);nf++;
   const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}}}

const work=packs.filter(p=>p.t>1000);
work.sort((a,b)=>a.t-b.t);
const q=f=>work[Math.min(work.length-1,(work.length*f)|0)].t;
console.log(`пачек ${packs.length}, «с работой» (>1000 т) ${work.length}`);
console.log(`ДЛИНА: avg ${(work.reduce((s,p)=>s+p.t,0)/work.length).toFixed(0)} p50 ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} p95 ${q(0.95)} max ${work[work.length-1].t}`);
const P90=q(0.9);
const tail=work.filter(p=>p.t>=P90), body=work.filter(p=>p.t<P90);
function agg(set,name){
  const c={};let tt=0;
  for(const p of set){tt+=p.t;for(const k in p.cnt)c[k]=(c[k]||0)+p.cnt[k];}
  console.log(`\n=== ${name}: ${set.length} пачек, сумма ${tt} т, avg ${(tt/set.length).toFixed(0)} т`);
  console.log("  СОСТАВ (входов на пачку):");
  for(const k of Object.keys(c).sort((a,b)=>c[b]-c[a]))
    console.log(`    ${k.padEnd(16)} ${String(c[k]).padStart(6)}  ${(c[k]/set.length).toFixed(2)}/пачку`);
  const cost=new Float64Array(marks.length);
  for(const p of set)for(let i=0;i<marks.length;i++)cost[i]+=p.cost[i];
  const rows=[];for(let i=0;i<marks.length;i++)if(cost[i]>0)rows.push([marks[i][1],cost[i]]);
  rows.sort((x,y)=>y[1]-x[1]);
  console.log("  ТОП МЕТОК (такты / % / на пачку):");
  for(const [n,v] of rows.slice(0,14))
    console.log(`    ${n.padEnd(16)} ${String(v).padStart(9)} ${(100*v/tt).toFixed(1).padStart(5)} ${(v/set.length).toFixed(0).padStart(7)}`);
}
agg(tail,`ХВОСТ (>= p90 = ${P90} т)`);
agg(body,"ОСТАЛЬНЫЕ");
// распределение числа объектов (vsp_n — честное, см. комментарий у точки входа)
const h={};for(const p of work){const k=`${p.n} ${p.fast?"СЛИТАЯ":"старый"}`;
  (h[k]=h[k]||[]).push(p.t);}
console.log("\nОБЪЕКТОВ В ПАЧКЕ (vsp_n) + путь -> пачек / длина:");
for(const k of Object.keys(h).sort()){const a=h[k].sort((x,y)=>x-y);
  console.log(`   ${k.padEnd(12)}: ${String(a.length).padStart(4)} пачек, avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0).padStart(6)} p50 ${String(a[a.length>>1]).padStart(6)} p90 ${String(a[(a.length*0.9)|0]).padStart(6)} max ${String(a[a.length-1]).padStart(6)}`);}
