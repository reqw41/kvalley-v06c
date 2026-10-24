// tick_smooth.js — ПЛАВНОСТЬ, СВЕРЕННАЯ ПО ИГРОВЫМ ТИКАМ, А НЕ ПО КАДРАМ.
//
// ЗАЧЕМ ОТДЕЛЬНО ОТ beam_late. Там прогон отмеряется КАДРАМИ, и любая правка, меняющая
// длительность хотя бы одной операции, сдвигает момент потери прерывания => к тому же
// номеру кадра сборки приходят на РАЗНЫХ игровых тиках, с разным числом объектов на
// экране. Разброс доходит до полутора раз, и «ухудшение плавности» оказывается разной
// траекторией, а не разной ценой. Здесь прогон отмеряется ТИКАМИ (приращение `timer`,
// его крутит ISR), поэтому обе сборки исполняют одну и ту же логику тик-в-тик.
//
// Что считает на каждом игровом тике (только GameStatus=5):
//   ДЛИНА ТИКА  — тактов i8080 от входа в H_TIMI до его возврата;
//   ОТ ПРЕРЫВАНИЯ — тактов от входа в ISR до возврата тика (это и есть метрика beam_late);
//   ДЛИННЫХ     — тиков, у которых «от прерывания» больше длины кадра (59904 такта).
//
// Запуск: node tools/verify/tick_smooth.js <rom> <sym> [тиков=2000]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NT=+(process.argv[4]||2000);
const FR=59904;
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu,memory}=E;
let TT=0; const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
const ISR=L.vec_isr, TICK=L.H_TIMI;
let irqT=-1, tickIn=-1, tickSP=-1, tickRet=-1;
const lenT=[], fromIrq=[]; let long=0;
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===ISR) irqT=TT;
  else if(pc===TICK&&tickRet<0){ tickIn=TT; tickSP=cpu.sp; tickRet=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8); }
  else if(tickRet>=0&&pc===tickRet&&cpu.sp>tickSP){
    if(rd(L.GameStatus)===5){ lenT.push(TT-tickIn); if(irqT>=0){ const d=TT-irqT; fromIrq.push(d); if(d>FR) long++; } }
    tickRet=-1;
  }
  return false;
};
let last=rd(L.timer), ticks=0, guard=0;
while(ticks<NT && guard++<NT*40){ v06c.oneInterrupt(true); const t=rd(L.timer); if(t!==last){ last=t; ticks++; } }
const st=a=>{ if(!a.length) return "нет данных"; const s=[...a].sort((x,y)=>x-y);
  const q=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];
  return `avg ${Math.round(a.reduce((x,y)=>x+y,0)/a.length)} p50 ${q(0.5)} p90 ${q(0.9)} max ${s[s.length-1]}`; };
console.log("ROM: "+ROM);
console.log(`игровых тиков ${ticks}, из них геймплейных ${lenT.length}`);
console.log(`ДЛИНА ТИКА (H_TIMI):    ${st(lenT)}`);
console.log(`ОТ ПРЕРЫВАНИЯ ДО КОНЦА: ${st(fromIrq)}`);
console.log(`ПЛАВНОСТЬ: тиков ДЛИННЕЕ кадра (${FR} тактов): ${long} = ${fromIrq.length?(100*long/fromIrq.length).toFixed(1):0}%`);
