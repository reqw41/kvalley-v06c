// burst_cost.js — ПЛОСКИЙ ПРОФИЛЬ ПАЧКИ ВЫВОДА ПО МЕТКАМ (задача #53, шаг «длина пачки»).
//
// ЗАЧЕМ. burst_raster_phase.js меряет ДЛИНУ пачки, но не говорит, из чего она состоит.
// Здесь: сумма тактов КАЖДОЙ инструкции, исполненной внутри vec_spr_out, отнесённая к
// БЛИЖАЙШЕЙ ПРЕДШЕСТВУЮЩЕЙ МЕТКЕ из .sym (self-time, без раскрутки стека — стек в этом
// коде хайджекается POP-ом, и бракетинг по SP тут врёт, см. frame_budget_cats).
// Печатает топ меток по суммарным тактам и по тактам на пачку.
// Запуск: node tools/verify/burst_cost.js [rom] [sym] [тиков=1200]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const TICKS=+(process.argv[4]||1200);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu,memory}=E;
const OUT=L.vec_spr_out;

// Карта адрес -> имя метки (только кодовые метки в диапазоне 0x0100..0x7600).
const marks=[];
for(const k in L){const a=L[k];if(a>=0x0100&&a<0x7600)marks.push([a,k]);}
marks.sort((x,y)=>x[0]-y[0]);
const MAP=new Uint16Array(0x8000); // индекс метки для каждого адреса
{let j=0;for(let a=0;a<0x8000;a++){while(j+1<marks.length&&marks[j+1][0]<=a)j++;MAP[a]=j;}}

const cost=new Float64Array(marks.length);
let gs=0,inOut=false,oret=-1,osp=0,bursts=0,total=0,cur=0;
const dur=[];
let TT=0;const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  if(inOut){const i=MAP[cpu.pc&0x7fff];oI();const c=cpu.vcycles|0;cost[i]+=c;cur+=c;}
  else oI();
};
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(gs!==5)return false;
  if(pc===OUT&&!inOut){
    osp=cpu.sp;oret=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
    inOut=true;cur=0;
  } else if(inOut&&pc===oret&&cpu.sp>osp){
    inOut=false;bursts++;total+=cur;dur.push(cur);
  }
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

const b=dur.slice().sort((x,y)=>x-y);
console.log(`пачек ${bursts}, сумма тактов ${total}, на пачку avg ${(total/bursts).toFixed(0)} p50 ${b[b.length>>1]} p90 ${b[(b.length*0.9)|0]} max ${b[b.length-1]}`);
const rows=[];
for(let i=0;i<marks.length;i++)if(cost[i]>0)rows.push([marks[i][1],cost[i]]);
rows.sort((x,y)=>y[1]-x[1]);
console.log("метка              такты      %     на пачку");
let acc=0;
for(const [n,c] of rows.slice(0,40)){acc+=c;
  console.log(`${n.padEnd(18)} ${String(c).padStart(9)} ${(100*c/total).toFixed(1).padStart(5)} ${(c/bursts).toFixed(0).padStart(9)}`);}
console.log(`(топ-40 = ${(100*acc/total).toFixed(1)}% пачки; всего меток с тактами ${rows.length})`);
