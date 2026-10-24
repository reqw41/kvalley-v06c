// pal_writers.js — КТО пишет палитру (порт 0x0C) и НАСКОЛЬКО эти записи избыточны.
// Зачем: vec_brillo_pal переписывает три пары слотов КАЖДЫЙ кадр (932 такта в шапке ISR,
// это 37% всего, что стоит перед пачкой вывода спрайтов). Если внутри уровня слоты idx8/idx10
// никто, кроме самого brillo, не трогает, то 2 из 3 пар — чистая трата тактов, и её можно
// снять кэшем «последнее записанное значение».
// Запуск: node tools/verify/pal_writers.js <rom> <sym> [тиков=2000]
"use strict";
const {make}=require("./beam_harness.js");
const ROM=process.argv[2],SYM=process.argv[3],NT=+(process.argv[4]||2000);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu,io}=E;
const oO=io.output.bind(io);
let idx=0;const w={};        // "PC" -> {n, slots:Set}
const slotVal={};            // слот -> последнее значение
const redundant={},total={};
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){cpu.last_pc=cpu.pc;oI();};
io.output=function(port,val){
  if(port===2)idx=val&15;
  if(port===12){
    const pc=(cpu.last_pc||0)&0xffff, k=pc.toString(16);
    const gs=rd(L.GameStatus);
    const key=k+" GS"+gs;
    total[key]=(total[key]||0)+1;
    if(slotVal[idx]===val)redundant[key]=(redundant[key]||0)+1;
    slotVal[idx]=val;
    (w[key]||(w[key]=new Set())).add(idx);
  }
  return oO(port,val);};
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
const ks=Object.keys(total).sort((a,b)=>total[b]-total[a]);
console.log("записи в порт 0x0C (цвет): PC GS -> всего / из них ЗНАЧЕНИЕ НЕ ИЗМЕНИЛОСЬ / слоты");
for(const k of ks.slice(0,25))
  console.log("  PC "+k.padEnd(10)+String(total[k]).padStart(7)+" / "+String(redundant[k]||0).padStart(7)+
    "  слоты "+[...w[k]].sort((a,b)=>a-b).join(","));
