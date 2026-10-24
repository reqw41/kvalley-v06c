// vflf_cost.js — ЗАДАЧА#47: цена скана «грязных» флагов (фаза F, vflf_*) на игровой тик.
// Считает такты i8080 по диапазонам PC внутри vec_nat_sprites:
//   head  = vec_nat_sprites..vflf_nofc  (детект смены GameStatus + форс-заливка)
//   scanF = vflf_nofc..vflm_gate        (инициализация + 21-слотный цикл cur/prev)
//   merge = vflm_gate..vflm_done        (слияние sticky-dirty, гейт vfl_dany)
//   рядом для масштаба: vflm_done..vfla_go (гейт vfl_any) и знание, как часто vfl_any==0.
// Запуск: node tools/verify/vflf_cost.js <rom> <sym> [кадров=1200]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||1200);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu,key}=E;
const R=[
 ["head ",L.vec_nat_sprites,L.vflf_nofc],
 ["scanF",L.vflf_nofc,L.vflm_gate],
 ["merge",L.vflm_gate,L.vflm_done],
 ["gateA",L.vflm_done,L.vfla_go],
 ["list+P+prep",L.vfla_go,L.vsp_prep_end||L.vflm_done+0x300],
];
const acc=new Array(R.length).fill(0);
let ticks=0, anyZero=0, anyOne=0;
const oI=cpu.instruction.bind(cpu);
let active=false;
cpu.instruction=function(){
  const pc=cpu.pc; oI(); if(!active)return;
  const vc=cpu.vcycles|0;
  for(let i=0;i<R.length;i++) if(pc>=R[i][1]&&pc<R[i][2]){acc[i]+=vc;break;}
  if(pc===L.H_TIMI)ticks++;
  if(pc===L.vflm_done){ if(rd(L.vfl_any)===0)anyZero++; else anyOne++; }
};
active=true;
for(let f=0;f<NF;f++){
  // движение: полсекунды вправо, полсекунды влево — репрезентативный геймплей
  const k=(f%100)<50?39:37;
  key(k,1); v06c.oneInterrupt(true); key(k,0);
}
active=false;
console.log(`кадров=${NF} игровых тиков=${ticks}`);
for(let i=0;i<R.length;i++)
  console.log(`  ${R[i][0].padEnd(12)} ${(acc[i]/ticks).toFixed(1).padStart(8)} т/тик  (диапазон ${R[i][1].toString(16)}..${R[i][2].toString(16)})`);
console.log(`vfl_any==0 после merge: ${anyZero}/${anyZero+anyOne} (${(100*anyZero/(anyZero+anyOne)).toFixed(1)}%)`);
