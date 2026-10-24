// isr_shadow_watch.js — кто в ISR портит теневые ячейки Z80 (z80_ix/iy/*_alt, il_*) ДО H_TIMI.
// Зачем: шапка ISR тратит ~500 тактов на их сохранение ПЕРЕД пачкой вывода спрайтов. Если до
// игрового тика их никто не пишет, сохранение можно перенести ВНИЗ и подвинуть пачку раньше
// на эти такты. Скрипт ловит записи и печатает адрес кода-виновника.
// Запуск: node tools/verify/isr_shadow_watch.js <rom> <sym> [тиков=2000]
"use strict";
const {make}=require("./beam_harness.js");
const ROM=process.argv[2],SYM=process.argv[3],NT=+(process.argv[4]||2000);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu,memory}=E;
const NAMES=["z80_ix","z80_iy","z80_af_alt","z80_bc_alt","z80_de_alt","z80_hl_alt","il_tmp","il_tmp2","il_a"];
const watch={};
for(const n of NAMES){if(L[n]===undefined){console.log("нет символа "+n);continue;}
  watch[L[n]]=n;watch[L[n]+1]=n+"+1";}
// окно наблюдения: от входа ISR (depth 0) до вызова H_TIMI
let inHead=false;const hits={};
const ISR=L.vec_isr,TICK=L.H_TIMI;
const ow=memory.write.bind(memory);
memory.write=function(a,v,x){
  if(inHead){const n=watch[a&0xffff];if(n!==undefined){const k=n+" <- PC "+((cpu.last_pc||cpu.pc)&0xffff).toString(16);hits[k]=(hits[k]||0)+1;}}
  return ow(a,v,x);};
let lastPc=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){cpu.last_pc=cpu.pc;oI();};
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0)inHead=true;
  if(pc===TICK)inHead=false;
  return false;};
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);} else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);} else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);} else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);} else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);} return k;}
let held=new Set(),tick=0,nf=0;const TIMER=L.timer;let prevT=rd(TIMER);
while(tick<=NT&&nf<400000){
  const want=new Set(keysFor(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;v06c.oneInterrupt(true);nf++;
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
}
const ks=Object.keys(hits).sort((a,b)=>hits[b]-hits[a]);
console.log("записей в теневые ячейки МЕЖДУ входом ISR и H_TIMI: "+(ks.length?"":"НЕТ"));
for(const k of ks)console.log("  "+k+"  x"+hits[k]);
